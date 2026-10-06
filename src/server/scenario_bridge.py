from dataclasses import dataclass
from typing import List, Dict, Any


@dataclass
class Waypoint:
    x: float
    y: float
    z: float


class CameraSplineInterpolator:
    @staticmethod
    def interpolate(points: List[Waypoint], steps_per_segment: int = 5) -> List[Waypoint]:
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
        self.current_water_level: float = 18.5
        self.alert_level: float = 21.0

    def process_agent_command(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if action == "SIMULATE_RAINFALL":
            rainfall_mm = float(params.get("rainfall_mm", 50.0))
            elevation_rise = round(rainfall_mm * 0.016, 2)
            self.current_water_level += elevation_rise
            is_warning = self.current_water_level >= self.alert_level
            return {
                "action": "UPDATE_WATER_SURFACE",
                "water_level": self.current_water_level,
                "rise": elevation_rise,
                "warning": is_warning,
            }
        elif action == "DISPATCH_INSPECTION_DRONE":
            route = [
                Waypoint(114.360, 30.470, 120.0),
                Waypoint(114.365, 30.475, 100.0),
                Waypoint(114.370, 30.480, 80.0),
            ]
            dense_path = CameraSplineInterpolator.interpolate(route, steps_per_segment=4)
            return {
                "action": "DRONE_FLIGHT_PATH",
                "waypoints": [{"x": p.x, "y": p.y, "z": p.z} for p in dense_path]
            }
        return {"action": "NOOP", "status": "unknown_action"}
