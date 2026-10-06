from server.scenario_bridge import ScenarioBridge, CameraSplineInterpolator, Waypoint


def test_camera_spline_interpolation():
    points = [Waypoint(0, 0, 100), Waypoint(10, 10, 50)]
    interpolated = CameraSplineInterpolator.interpolate(points, steps_per_segment=5)
    assert len(interpolated) == 6
    assert interpolated[0].z == 100
    assert interpolated[-1].z == 50


def test_scenario_bridge_rainfall_simulation():
    bridge = ScenarioBridge()
    init_level = bridge.current_water_level
    res = bridge.process_agent_command("SIMULATE_RAINFALL", {"rainfall_mm": 100.0})
    assert res["action"] == "UPDATE_WATER_SURFACE"
    assert res["water_level"] > init_level
    assert res["warning"] is True or res["warning"] is False
