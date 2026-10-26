import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  validateConfig, initialWaterState, addRainfall, presetWaterState, sceneWaterElevation,
  affectedBuildings, initialInspectionState, inspectionAction, advanceInspection
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
