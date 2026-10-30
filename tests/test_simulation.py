import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

from server.scenario_bridge import SCENARIO_CONFIG, ScenarioBridge, LinearWaypointInterpolator, Waypoint


def test_linear_waypoint_interpolation_preserves_segment_endpoints_and_midpoint():
    points = [Waypoint(0, 0, 100), Waypoint(10, 10, 50), Waypoint(30, 20, 0)]
    interpolated = LinearWaypointInterpolator.interpolate(points, steps_per_segment=4)
    assert len(interpolated) == 9
    assert interpolated[0] == points[0]
    assert interpolated[2] == Waypoint(5, 5, 75)
    assert interpolated[4] == points[1]
    assert interpolated[-1] == points[-1]


@pytest.mark.parametrize("steps", [0, -1, 1.5, True])
def test_linear_interpolation_rejects_invalid_steps(steps):
    with pytest.raises(ValueError):
        LinearWaypointInterpolator.interpolate([], steps)


def test_linear_interpolation_handles_short_routes_and_rejects_nonfinite_points():
    assert LinearWaypointInterpolator.interpolate([]) == []
    point = Waypoint(1, 2, 3)
    assert LinearWaypointInterpolator.interpolate([point]) == [point]
    with pytest.raises(ValueError):
        LinearWaypointInterpolator.interpolate([Waypoint(float("nan"), 0, 0)])


def test_scenario_bridge_rainfall_simulation():
    bridge = ScenarioBridge()
    res = bridge.process_agent_command("SIMULATE_RAINFALL", {"rainfall_mm": 100})
    assert res["action"] == "UPDATE_WATER_SURFACE"
    assert res["water_level"] == 20.1
    assert res["scene_water_y"] == pytest.approx(3.1)
    assert res["rise"] == 1.6
    assert res["rainfall_total_mm"] == 100
    assert res["warning"] is False
    assert res["simulation"] is True
    warning = bridge.process_agent_command("SIMULATE_RAINFALL", {"rainfall_mm": 56.25})
    assert warning["water_level"] == 21
    assert warning["warning"] is True


@pytest.mark.parametrize("rainfall", [-1, float("nan"), float("inf"), True, "50", "invalid", None])
def test_invalid_rainfall_does_not_mutate_state(rainfall):
    bridge = ScenarioBridge()
    with pytest.raises(ValueError):
        bridge.process_agent_command("SIMULATE_RAINFALL", {"rainfall_mm": rainfall})
    assert bridge.current_water_level == SCENARIO_CONFIG["base_water_level_m"]
    assert bridge.rainfall_total_mm == 0


def test_presets_reset_and_upper_bound():
    bridge = ScenarioBridge()
    for preset in SCENARIO_CONFIG["presets"]:
        result = bridge.process_agent_command("SET_PRESET", {"preset_id": preset["id"]})
        assert result["rainfall_total_mm"] == preset["rainfall_mm"]
        assert result["water_level"] == pytest.approx(
            SCENARIO_CONFIG["base_water_level_m"] + preset["rainfall_mm"] * SCENARIO_CONFIG["rainfall_rise_per_mm"])
    with pytest.raises(ValueError):
        bridge.process_agent_command("SET_PRESET", {"preset_id": "missing"})
    assert bridge.rainfall_total_mm == 200
    result = bridge.process_agent_command("SIMULATE_RAINFALL", {"rainfall_mm": 1e308})
    assert result["water_level"] == SCENARIO_CONFIG["max_water_level_m"]
    result = bridge.process_agent_command("RESET_WATER", {})
    assert result["water_level"] == SCENARIO_CONFIG["base_water_level_m"]
    assert result["rainfall_total_mm"] == 0
    assert result["warning"] is False


def test_route_response_declares_linear_simulation():
    result = ScenarioBridge().process_agent_command("DISPATCH_INSPECTION_DRONE", {})
    assert result["interpolation"] == "linear"
    assert result["simulation"] is True
    assert len(result["waypoints"]) == 9


def test_frontend_and_python_share_water_contract():
    node = os.environ.get("NODE_BINARY") or shutil.which("node")
    if node is None:
        pytest.skip("设置 NODE_BINARY 或将 Node 加入 PATH 后运行跨语言测试")
    client = Path(__file__).resolve().parents[1] / "src" / "client"
    script = """
import {readFileSync} from 'node:fs';
import {initialWaterState, addRainfall, sceneWaterElevation} from './scenario_model.mjs';
const config = JSON.parse(readFileSync('../shared/scenario_config.json', 'utf8'));
let state = initialWaterState(config);
const results = [0, 50, 50, 56.25, 900, 1e308].map(rain => {
  state = addRainfall(state, rain, config);
  return [state.level, state.rainfallMm, sceneWaterElevation(state.level, config)];
});
console.log(JSON.stringify({config_version: config.config_version, scene_id: config.scene_id, results}));
"""
    completed = subprocess.run([node, "--input-type=module", "-e", script], cwd=client,
                               capture_output=True, text=True, check=True, timeout=10)
    bridge = ScenarioBridge()
    frontend_output = json.loads(completed.stdout)
    for rain, frontend in zip([0, 50, 50, 56.25, 900, 1e308], frontend_output["results"]):
        result = bridge.process_agent_command("SIMULATE_RAINFALL", {"rainfall_mm": rain})
        assert result["config_version"] == frontend_output["config_version"]
        assert result["scene_id"] == frontend_output["scene_id"]
        assert frontend == pytest.approx([result["water_level"], result["rainfall_total_mm"], result["scene_water_y"]])
