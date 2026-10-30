function nonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} 必须为非负有限数值`);
  return value;
}

export function validateConfig(config) {
  if (typeof config.config_version !== 'string' || !config.config_version.trim() ||
      typeof config.scene_id !== 'string' || !config.scene_id.trim()) {
    throw new RangeError('缺少配置版本或场景标识');
  }
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

export function assessBuildings(buildings, waterY, halfExtent) {
  if (!Number.isFinite(waterY) || !(Number.isFinite(halfExtent) && halfExtent > 0)) {
    throw new RangeError('水面高度或范围无效');
  }
  const ids = new Set();
  return buildings.map(building => {
    if (typeof building.id !== 'string' || !building.id || ids.has(building.id)) {
      throw new RangeError('建筑标识为空或重复');
    }
    ids.add(building.id);
    const bounds = Object.fromEntries(['bottomY', 'minX', 'maxX', 'minZ', 'maxZ'].map(key => {
      if (!Number.isFinite(building[key])) throw new RangeError('建筑包围盒必须为有限数值');
      return [key, building[key]];
    }));
    if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) throw new RangeError('建筑包围盒范围无效');
    const overlapsWater = bounds.maxX >= -halfExtent && bounds.minX <= halfExtent &&
      bounds.maxZ >= -halfExtent && bounds.minZ <= halfExtent;
    const belowWater = waterY > bounds.bottomY;
    return {
      id: building.id,
      bounds_scene_units: bounds,
      overlaps_water_footprint: overlapsWater,
      bottom_below_mean_water: belowWater,
      affected: overlapsWater && belowWater,
      mean_water_above_bottom_m: overlapsWater ? Math.max(0, waterY - bounds.bottomY) : null
    };
  });
}

export function createSceneSnapshot({config, waterState, inspectionState, buildings, performance = null,
  exportedAt = new Date().toISOString()}) {
  validateConfig(config);
  if (!Number.isFinite(Date.parse(exportedAt))) throw new RangeError('导出时间无效');
  nonNegative(waterState.rainfallMm, '累计降雨量');
  if (!(Number.isFinite(waterState.level) && waterState.level >= config.base_water_level_m &&
        waterState.level <= config.max_water_level_m)) throw new RangeError('模拟水位超出配置范围');
  if (!['idle', 'running', 'paused'].includes(inspectionState.status) ||
      !Number.isFinite(inspectionState.progress) || inspectionState.progress < 0 || inspectionState.progress >= 1) {
    throw new RangeError('巡检状态无效');
  }
  const waterY = sceneWaterElevation(waterState.level, config);
  const assessments = assessBuildings(buildings, waterY, config.water_half_extent);
  return {
    schema_version: '1.0.0',
    simulation: true,
    exported_at: new Date(exportedAt).toISOString(),
    scene_id: config.scene_id,
    config_version: config.config_version,
    config: JSON.parse(JSON.stringify(config)),
    limitations: [
      '模拟建筑与简化降雨规则；不代表实测水文、真实灾损或风险等级。',
      '建筑判定使用平均水面与包围盒，视觉波浪不参与统计。',
      '性能数据为当前浏览器 requestAnimationFrame 间隔，不是 GPU 耗时或跨设备性能保证。'
    ],
    water: {
      level_m: waterState.level,
      rainfall_total_mm: waterState.rainfallMm,
      scene_water_y: waterY,
      scene_units_per_simulated_m: 1,
      alert_threshold_reached: waterState.level >= config.alert_water_level_m
    },
    impact: {
      rule: 'mean_water_y > bottomY AND bounding_box_overlaps_water_footprint',
      water_footprint: {minX: -config.water_half_extent, maxX: config.water_half_extent,
        minZ: -config.water_half_extent, maxZ: config.water_half_extent},
      total_buildings: assessments.length,
      affected_buildings: assessments.filter(building => building.affected).length,
      buildings: assessments
    },
    inspection: {status: inspectionState.status, progress: inspectionState.progress,
      cycle_duration_seconds: config.inspection_duration_seconds, route: 'closed Catmull-Rom demonstration'},
    performance: performance === null ? null : JSON.parse(JSON.stringify(performance))
  };
}

export class FrameSampler {
  constructor(windowMs = 5000) {
    if (!(Number.isFinite(windowMs) && windowMs > 0)) throw new RangeError('采样窗口必须大于零');
    this.windowMs = windowMs;
    this.samples = [];
    this.previousTimestamp = null;
    this.suspendedReason = null;
  }

  setSuspended(reason = null) {
    if (![null, 'paused', 'hidden', 'context-lost'].includes(reason)) throw new RangeError('采样暂停原因无效');
    if (this.suspendedReason !== reason) {
      this.samples = [];
      this.previousTimestamp = null;
      this.suspendedReason = reason;
    }
  }

  sample(timestamp) {
    nonNegative(timestamp, '帧时间戳');
    if (this.suspendedReason !== null) return;
    if (this.previousTimestamp !== null) {
      if (timestamp <= this.previousTimestamp) throw new RangeError('帧时间戳必须递增');
      this.samples.push({end: timestamp, duration: timestamp - this.previousTimestamp});
    }
    this.previousTimestamp = timestamp;
    this.samples = this.samples.filter(sample => sample.end > timestamp - this.windowMs);
  }

  report() {
    const durations = this.samples.map(sample => sample.duration);
    const count = durations.length;
    const total = durations.reduce((sum, duration) => sum + duration, 0);
    const sorted = [...durations].sort((a, b) => a - b);
    return {
      source: 'requestAnimationFrame intervals',
      configured_window_ms: this.windowMs,
      suspended_reason: this.suspendedReason,
      sample_count: count,
      sampled_duration_ms: total,
      average_fps: count ? 1000 * count / total : null,
      mean_frame_interval_ms: count ? total / count : null,
      p95_frame_interval_ms: count ? sorted[Math.ceil(count * 0.95) - 1] : null
    };
  }
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
