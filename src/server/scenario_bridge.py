from dataclasses import dataclass
from typing import List, Dict, Any
import json
import math
from pathlib import Path


SCENARIO_CONFIG = json.loads(
    (Path(__file__).resolve().parents[1] / "shared" / "scenario_config.json").read_text(encoding="utf-8")
)


def _non_negative_number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name}必须为非负有限数值")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name}必须为非负有限数值") from exc
    if not math.isfinite(result) or result < 0:
        raise ValueError(f"{name}必须为非负有限数值")
    return result


@dataclass
class Waypoint:
    x: float
    y: float
    z: float


class LinearWaypointInterpolator:
    @staticmethod
    def interpolate(points: List[Waypoint], steps_per_segment: int = 5) -> List[Waypoint]:
        if isinstance(steps_per_segment, bool) or not isinstance(steps_per_segment, int) or steps_per_segment < 1:
            raise ValueError("每段插值步数必须为正整数")
        if any(not math.isfinite(value) for point in points for value in (point.x, point.y, point.z)):
            raise ValueError("航点坐标必须为有限数值")
        if len(points) < 2:
            return points
        result = []
        for i in range(len(points) - 1):
            p0 = points[i]
            p1 = points[i + 1]
            for step in range(steps_per_segment):
                t = step / float(steps_per_segment)
                result.append(Waypoint(
                    x=round(p0.x + (p1.x - p0.x) * t, 6),
                    y=round(p0.y + (p1.y - p0.y) * t, 6),
                    z=round(p0.z + (p1.z - p0.z) * t, 2),
                ))
        result.append(points[-1])
        return result


class ScenarioBridge:
    def __init__(self):
        self.current_water_level: float = SCENARIO_CONFIG["base_water_level_m"]
        self.alert_level: float = SCENARIO_CONFIG["alert_water_level_m"]
        self.rainfall_total_mm: float = 0

    def _water_result(self, previous_level: float) -> Dict[str, Any]:
        return {
            "action": "UPDATE_WATER_SURFACE",
            "water_level": self.current_water_level,
            "scene_water_y": self.current_water_level - SCENARIO_CONFIG["scene_datum_m"],
            "rise": round(self.current_water_level - previous_level, 2),
            "warning": self.current_water_level >= self.alert_level,
            "rainfall_total_mm": self.rainfall_total_mm,
            "simulation": True,
        }

    def process_agent_command(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if action == "SIMULATE_RAINFALL":
            rainfall_mm = _non_negative_number(params.get("rainfall_mm", SCENARIO_CONFIG["rainfall_step_mm"]), "降雨量")
            rainfall_total = self.rainfall_total_mm + rainfall_mm
            if not math.isfinite(rainfall_total):
                raise ValueError("累计降雨量超出数值范围")
            previous_level = self.current_water_level
            bounded_level = min(SCENARIO_CONFIG["max_water_level_m"],
                                previous_level + rainfall_mm * SCENARIO_CONFIG["rainfall_rise_per_mm"])
            self.current_water_level = math.floor(bounded_level * 100 + 0.5) / 100
            self.rainfall_total_mm = rainfall_total
            return self._water_result(previous_level)
        elif action in ("RESET_WATER", "SET_PRESET"):
            rainfall_mm = 0
            if action == "SET_PRESET":
                preset = next((item for item in SCENARIO_CONFIG["presets"] if item["id"] == params.get("preset_id")), None)
                if preset is None:
                    raise ValueError("未知模拟预设")
                rainfall_mm = preset["rainfall_mm"]
            previous_level = self.current_water_level
            self.current_water_level = SCENARIO_CONFIG["base_water_level_m"]
            self.rainfall_total_mm = 0
            self.process_agent_command("SIMULATE_RAINFALL", {"rainfall_mm": rainfall_mm})
            return self._water_result(previous_level)
        elif action == "DISPATCH_INSPECTION_DRONE":
            route = [
                Waypoint(114.360, 30.470, 120.0),
                Waypoint(114.365, 30.475, 100.0),
                Waypoint(114.370, 30.480, 80.0),
            ]
            dense_path = LinearWaypointInterpolator.interpolate(route, steps_per_segment=4)
            return {
                "action": "DRONE_FLIGHT_PATH",
                "waypoints": [{"x": p.x, "y": p.y, "z": p.z} for p in dense_path],
                "interpolation": "linear",
                "simulation": True,
            }
        return {"action": "NOOP", "status": "unknown_action"}
