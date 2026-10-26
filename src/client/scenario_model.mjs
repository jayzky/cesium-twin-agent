function nonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} 必须为非负有限数值`);
  return value;
}

export function validateConfig(config) {
  for (const key of ['base_water_level_m', 'alert_water_level_m', 'max_water_level_m', 'scene_datum_m']) {
    if (!Number.isFinite(config[key])) throw new RangeError(`${key} 必须为有限数值`);
  }
  if (!(config.base_water_level_m < config.alert_water_level_m && config.alert_water_level_m <= config.max_water_level_m)) {
    throw new RangeError('基准、警戒与最高模拟水位顺序无效');
  }
  for (const key of ['rainfall_rise_per_mm', 'rainfall_step_mm', 'water_half_extent', 'inspection_duration_seconds']) {
    if (!(nonNegative(config[key], key) > 0)) throw new RangeError(`${key} 必须大于零`);
  }
  if (!Array.isArray(config.presets) || config.presets.length === 0) throw new RangeError('缺少模拟预设');
  const ids = new Set();
  for (const preset of config.presets) {
    if (!preset.id || ids.has(preset.id) || !preset.label) throw new RangeError('预设名称或标识无效');
    ids.add(preset.id);
    nonNegative(preset.rainfall_mm, '预设降雨量');
  }
  return config;
}

export function initialWaterState(config) {
  return {level: config.base_water_level_m, rainfallMm: 0};
}

export function addRainfall(state, rainfallMm, config) {
  nonNegative(rainfallMm, '降雨量');
  const rainfallTotal = state.rainfallMm + rainfallMm;
  if (!Number.isFinite(rainfallTotal)) throw new RangeError('累计降雨量超出数值范围');
  const boundedLevel = Math.min(config.max_water_level_m, state.level + rainfallMm * config.rainfall_rise_per_mm);
  const level = Math.round(boundedLevel * 100) / 100;
  return {level, rainfallMm: rainfallTotal};
}

export function presetWaterState(presetId, config) {
  const preset = config.presets.find(item => item.id === presetId);
  if (!preset) throw new RangeError('未知模拟预设');
  return addRainfall(initialWaterState(config), preset.rainfall_mm, config);
}

export function sceneWaterElevation(level, config) {
  return level - config.scene_datum_m;
}

export function affectedBuildings(buildings, waterY, halfExtent) {
  return buildings.filter(building =>
    waterY > building.bottomY &&
    building.maxX >= -halfExtent && building.minX <= halfExtent &&
    building.maxZ >= -halfExtent && building.minZ <= halfExtent);
}

export function initialInspectionState() {
  return {status: 'idle', progress: 0};
}

export function inspectionAction(state, action) {
  if (action === 'reset') return initialInspectionState();
  if (action === 'start') return {...state, status: 'running'};
  if (action === 'pause') return {...state, status: state.status === 'idle' ? 'idle' : 'paused'};
  throw new RangeError('未知巡检操作');
}

export function advanceInspection(state, deltaSeconds, durationSeconds) {
  nonNegative(deltaSeconds, '帧间隔');
  if (!(Number.isFinite(durationSeconds) && durationSeconds > 0)) throw new RangeError('巡检周期必须大于零');
  if (state.status !== 'running') return state;
  return {...state, progress: (state.progress + deltaSeconds / durationSeconds) % 1};
}
