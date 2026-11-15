"""Loading and validating the calculator CSV inputs."""

from __future__ import annotations

import csv
import math
from collections import Counter
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Dict, Iterable, Mapping, Tuple


QUANTILES = tuple(f"{value / 10:.1f}" for value in range(1, 10))
ROUTE_COLUMNS = {
    "route",
    "name",
    "base_price",
    "cost_per_passenger",
    "price_sensitivity",
    "price_min",
    "price_max",
}
FORECAST_COLUMNS = {"route", "date", "seats"} | {
    f"{quantile}_base_demand" for quantile in QUANTILES
}


class DataValidationError(ValueError):
    """Raised when an input CSV does not satisfy the application contract."""


@dataclass(frozen=True)
class Route:
    code: str
    name: str
    origin: str
    destination: str
    base_price: float
    cost_per_passenger: float
    price_sensitivity: float
    price_min: float
    price_max: float


@dataclass(frozen=True)
class Forecast:
    route: str
    flight_date: date
    seats: int
    base_demand: Mapping[str, float]


class CalculatorData:
    """Validated, in-memory view of route parameters and forecast rows."""

    def __init__(
        self, routes: Mapping[str, Route], forecasts: Mapping[Tuple[str, date], Forecast]
    ) -> None:
        self.routes = dict(routes)
        self.forecasts = dict(forecasts)

    @classmethod
    def from_csv(cls, routes_path: Path, forecast_path: Path) -> "CalculatorData":
        routes = _load_routes(routes_path)
        forecasts = _load_forecasts(forecast_path, routes)
        if not forecasts:
            raise DataValidationError("Файл прогноза не содержит строк.")
        return cls(routes, forecasts)

    def flight_options(self) -> list[dict[str, str | float]]:
        return [
            {
                "route": route_code,
                "name": self.routes[route_code].name,
                "origin": self.routes[route_code].origin,
                "destination": self.routes[route_code].destination,
                "date": flight_date.isoformat(),
                "base_price": self.routes[route_code].base_price,
            }
            for route_code, flight_date in sorted(self.forecasts)
        ]


def _read_csv(path: Path, required_columns: Iterable[str]) -> list[dict[str, str]]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            columns = Counter(reader.fieldnames or [])
            duplicates = [name for name, count in columns.items() if count > 1]
            if duplicates:
                raise DataValidationError(f"{path.name}: повтор столбцов: {', '.join(duplicates)}.")
            missing = set(required_columns) - columns.keys()
            if missing:
                names = ", ".join(sorted(missing))
                raise DataValidationError(f"{path.name}: отсутствуют столбцы: {names}.")
            return list(reader)
    except FileNotFoundError as error:
        raise DataValidationError(f"Файл данных не найден: {path}.") from error
    except OSError as error:
        raise DataValidationError(f"Не удалось прочитать {path}: {error}.") from error


def _number(value: str, field: str, row_number: int) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as error:
        raise DataValidationError(
            f"Строка {row_number}: поле {field} должно быть числом."
        ) from error
    if not math.isfinite(parsed):
        raise DataValidationError(f"Строка {row_number}: поле {field} не является конечным.")
    return parsed


def _load_routes(path: Path) -> Dict[str, Route]:
    rows = _read_csv(path, ROUTE_COLUMNS)
    routes: Dict[str, Route] = {}
    for row_number, row in enumerate(rows, start=2):
        code = (row.get("route") or "").strip()
        if not code:
            raise DataValidationError(f"Строка {row_number}: пустой код маршрута.")
        if code in routes:
            raise DataValidationError(f"Строка {row_number}: повтор маршрута {code}.")
        name = (row.get("name") or "").strip()
        cities = [part.strip() for part in name.split("—")]
        if len(cities) != 2 or not all(cities):
            raise DataValidationError(
                f"{path.name}, строка {row_number} ({code}): ожидается name в формате «город — город»."
            )
        route = Route(
            code=code,
            name=name,
            origin=cities[0],
            destination=cities[1],
            base_price=_number(row["base_price"], "base_price", row_number),
            cost_per_passenger=_number(
                row["cost_per_passenger"], "cost_per_passenger", row_number
            ),
            price_sensitivity=_number(
                row["price_sensitivity"], "price_sensitivity", row_number
            ),
            price_min=_number(row["price_min"], "price_min", row_number),
            price_max=_number(row["price_max"], "price_max", row_number),
        )
        if route.price_min > route.price_max:
            raise DataValidationError(f"Строка {row_number}: неверный диапазон цены.")
        if route.price_sensitivity < 0:
            raise DataValidationError(f"Строка {row_number}: чувствительность не может быть отрицательной.")
        routes[code] = route
    if not routes:
        raise DataValidationError(f"{path.name}: справочник маршрутов пуст.")
    return routes


def _load_forecasts(path: Path, routes: Mapping[str, Route]) -> Dict[Tuple[str, date], Forecast]:
    rows = _read_csv(path, FORECAST_COLUMNS)
    forecasts: Dict[Tuple[str, date], Forecast] = {}
    for row_number, row in enumerate(rows, start=2):
        route_code = (row.get("route") or "").strip()
        if route_code not in routes:
            raise DataValidationError(
                f"Строка {row_number}: маршрут {route_code} отсутствует в routes.csv."
            )
        try:
            flight_date = date.fromisoformat((row.get("date") or "").strip())
        except ValueError as error:
            raise DataValidationError(
                f"Строка {row_number}: дата должна быть в формате YYYY-MM-DD."
            ) from error
        key = (route_code, flight_date)
        if key in forecasts:
            raise DataValidationError(f"Строка {row_number}: повтор рейса {route_code}/{flight_date}.")
        seats_value = _number(row["seats"], "seats", row_number)
        if seats_value < 0 or not seats_value.is_integer():
            raise DataValidationError(f"Строка {row_number}: seats должно быть целым числом >= 0.")
        base_demand = {
            quantile: _number(row[f"{quantile}_base_demand"], f"{quantile}_base_demand", row_number)
            for quantile in QUANTILES
        }
        for lower, upper in zip(QUANTILES, QUANTILES[1:]):
            if base_demand[lower] > base_demand[upper]:
                raise DataValidationError(
                    f"{path.name}, строка {row_number} ({route_code}/{flight_date}): "
                    f"{lower}_base_demand больше {upper}_base_demand."
                )
        forecasts[key] = Forecast(
            route=route_code,
            flight_date=flight_date,
            seats=int(seats_value),
            base_demand=base_demand,
        )
    return forecasts
