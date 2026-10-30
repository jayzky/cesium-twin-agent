import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  validateConfig, initialWaterState, addRainfall, presetWaterState, sceneWaterElevation,
  affectedBuildings, initialInspectionState, inspectionAction, advanceInspection,
  assessBuildings, createSceneSnapshot, FrameSampler
} from '../src/client/scenario_model.mjs';

const config = validateConfig(JSON.parse(readFileSync(new URL('../src/shared/scenario_config.json', import.meta.url), 'utf8')));

test('rainfall, scene coordinates, reset and warning preset follow shared configuration', () => {
  const initial = initialWaterState(config);
  const rainy = addRainfall(initial, 50, config);
  assert.equal(rainy.level, 19.3);
  assert.ok(Math.abs(sceneWaterElevation(rainy.level, config) - 2.3) < 1e-10);
  assert.deepEqual(initialWaterState(config), initial);
  assert.equal(presetWaterState('rain200', config).level, 21.7);
  assert.equal(addRainfall(initial, 1e308, config).level, config.max_water_level_m);
  for (const invalid of [-1, NaN, Infinity, true, '50']) {
    assert.throws(() => addRainfall(initial, invalid, config), RangeError);
  }
  assert.throws(() => presetWaterState('missing', config), RangeError);
  assert.throws(() => validateConfig({...config, alert_water_level_m: 10}), RangeError);
});

test('affected buildings require a submerged actual bottom and water-footprint overlap', () => {
  const box = {bottomY: 2, minX: -5, maxX: 5, minZ: -5, maxZ: 5};
  const raised = {...box, bottomY: 4};
  const outside = {...box, minX: 61, maxX: 70};
  const edge = {...box, minX: 59, maxX: 64};
  assert.equal(affectedBuildings([box], 2, 60).length, 0);
  assert.deepEqual(affectedBuildings([box, raised, outside, edge], 3, 60), [box, edge]);
  assert.equal(affectedBuildings([box, raised], 5, 60).length, 2);
});

test('inspection speed is independent of frame rate', () => {
  const run = steps => {
    let state = inspectionAction(initialInspectionState(), 'start');
    for (let i = 0; i < steps; i++) state = advanceInspection(state, 5 / steps, 20);
    return state.progress;
  };
  assert.ok(Math.abs(run(30) - 0.25) < 1e-10);
  assert.ok(Math.abs(run(300) - run(30)) < 1e-10);
});

test('inspection pause holds position, resume keeps progress and reset stops at origin', () => {
  let state = inspectionAction(initialInspectionState(), 'start');
  state = advanceInspection(state, 5, 20);
  state = inspectionAction(state, 'pause');
  assert.equal(advanceInspection(state, 10, 20).progress, 0.25);
  state = inspectionAction(state, 'start');
  assert.equal(advanceInspection(state, 5, 20).progress, 0.5);
  state = inspectionAction(state, 'reset');
  assert.deepEqual(advanceInspection(state, 10, 20), {status: 'idle', progress: 0});
  assert.equal(advanceInspection(inspectionAction(state, 'start'), 25, 20).progress, 0.25);
  assert.throws(() => advanceInspection(state, -1, 20), RangeError);
  assert.throws(() => advanceInspection(state, 1, 0), RangeError);
  assert.throws(() => inspectionAction(state, 'missing'), RangeError);
});

test('snapshot retains reproducible simulation inputs and per-building decision evidence without mesh objects', () => {
  const base = {bottomY: 2, minX: -5, maxX: 5, minZ: -5, maxZ: 5};
  const buildings = [
    {...base, id: 'submerged', mesh: {notSerializable: () => {}}},
    {...base, id: 'at-water', bottomY: 3},
    {...base, id: 'outside', minX: 61, maxX: 70}
  ];
  const snapshot = createSceneSnapshot({config, waterState: {level: 20, rainfallMm: 93.75},
    inspectionState: {status: 'paused', progress: 0.25}, buildings, exportedAt: '2026-10-30T12:00:00Z'});
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.config_version, config.config_version);
  assert.equal(snapshot.scene_id, config.scene_id);
  assert.equal(snapshot.exported_at, '2026-10-30T12:00:00.000Z');
  assert.equal(snapshot.water.scene_water_y, 3);
  assert.equal(snapshot.impact.affected_buildings, 1);
  assert.equal(snapshot.impact.total_buildings, 3);
  assert.equal(snapshot.impact.buildings[0].mean_water_above_bottom_m, 1);
  assert.equal(snapshot.impact.buildings[1].affected, false);
  assert.equal(snapshot.impact.buildings[2].overlaps_water_footprint, false);
  assert.equal(snapshot.impact.buildings[2].mean_water_above_bottom_m, null);
  assert.ok(!('mesh' in snapshot.impact.buildings[0]));
  assert.equal(snapshot.inspection.progress, 0.25);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  snapshot.config.presets[0].label = 'changed';
  assert.notEqual(config.presets[0].label, 'changed');
  assert.deepEqual(snapshot.impact.buildings.filter(item => item.affected).map(item => item.id),
    affectedBuildings(buildings, 3, config.water_half_extent).map(item => item.id));
});

test('snapshot rejects ambiguous identifiers, invalid bounds and invalid state instead of exporting misleading JSON', () => {
  const building = {id: 'one', bottomY: 2, minX: -5, maxX: 5, minZ: -5, maxZ: 5};
  assert.throws(() => assessBuildings([building, building], 3, 60), RangeError);
  assert.throws(() => assessBuildings([{...building, bottomY: NaN}], 3, 60), RangeError);
  assert.throws(() => assessBuildings([{...building, minX: 10}], 3, 60), RangeError);
  const args = {config, waterState: initialWaterState(config), inspectionState: initialInspectionState(), buildings: [building]};
  assert.throws(() => createSceneSnapshot({...args, waterState: {level: 99, rainfallMm: 0}}), RangeError);
  assert.throws(() => createSceneSnapshot({...args, inspectionState: {status: 'running', progress: 1}}), RangeError);
  assert.throws(() => createSceneSnapshot({...args, exportedAt: 'invalid'}), RangeError);
  assert.throws(() => validateConfig({...config, config_version: ''}), RangeError);
});

test('performance uses elapsed sampling duration and nearest-rank P95 rather than averaging instantaneous FPS', () => {
  const sampler = new FrameSampler(100);
  assert.equal(sampler.report().average_fps, null);
  for (const timestamp of [0, 10, 40]) sampler.sample(timestamp);
  const report = sampler.report();
  assert.equal(report.sample_count, 2);
  assert.equal(report.sampled_duration_ms, 40);
  assert.equal(report.average_fps, 50);
  assert.equal(report.mean_frame_interval_ms, 20);
  assert.equal(report.p95_frame_interval_ms, 30);
  assert.equal(report.configured_window_ms, 100);
  sampler.sample(150);
  assert.equal(sampler.report().sample_count, 1);
  assert.equal(sampler.report().sampled_duration_ms, 110);
  assert.equal(sampler.report().p95_frame_interval_ms, 110);
});

test('performance suspension discards paused or hidden time and resumes with a fresh baseline', () => {
  const sampler = new FrameSampler();
  sampler.sample(100);
  sampler.sample(120);
  for (const reason of ['paused', 'hidden', 'context-lost']) {
    sampler.setSuspended(reason);
    sampler.sample(5000);
    assert.equal(sampler.report().suspended_reason, reason);
    assert.equal(sampler.report().sample_count, 0);
  }
  sampler.setSuspended(null);
  sampler.sample(10000);
  assert.equal(sampler.report().sample_count, 0);
  sampler.sample(10020);
  assert.equal(sampler.report().average_fps, 50);
  assert.throws(() => sampler.sample(10020), RangeError);
  assert.throws(() => sampler.sample(Infinity), RangeError);
  assert.throws(() => sampler.setSuspended('invalid'), RangeError);
  assert.throws(() => new FrameSampler(0), RangeError);
});
