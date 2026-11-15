"""FastAPI application for the sales calculator."""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .data_loader import CalculatorData, DataValidationError, QUANTILES


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
FORECAST_FILENAME = os.getenv("FORECAST_FILENAME", "ПоповАлександрМаксимович_my_forecast.csv")
FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend" / "dist" / "browser"


def load_data() -> CalculatorData:
    return CalculatorData.from_csv(
        DATA_DIR / "routes.csv",
        DATA_DIR / FORECAST_FILENAME,
    )


try:
    calculator_data = load_data()
except DataValidationError as error:
    raise RuntimeError(f"Ошибка загрузки данных калькулятора: {error}") from error

app = FastAPI(title="Динамическое ценообразование авиабилетов", version="1.0.0")


class PredictionRequest(BaseModel):
    route: str = Field(min_length=1)
    date: date
    price: float = Field(gt=0, strict=True, allow_inf_nan=False)

    @field_validator("price")
    @classmethod
    def validate_kopecks(cls, value: float) -> float:
        if round(value, 2) != value:
            raise ValueError("Укажите цену с точностью до копейки.")
        return value


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
    # Rejected inputs can contain infinity, which cannot be echoed in JSON.
    detail = [
        {key: issue[key] for key in ("loc", "msg", "type")}
        for issue in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": detail})


@app.get("/flights")
def flights() -> dict[str, object]:
    return {
        "source": FORECAST_FILENAME,
        "flights": calculator_data.flight_options(),
    }


@app.post("/predict")
def predict(request: PredictionRequest) -> dict[str, object]:
    route = calculator_data.routes.get(request.route)
    forecast = calculator_data.forecasts.get((request.route, request.date))
    if route is None or forecast is None:
        raise HTTPException(
            status_code=404,
            detail="Для выбранного маршрута и даты прогноз не найден.",
        )
    demand = {
        quantile: round(
            forecast.base_demand[quantile]
            - route.price_sensitivity * (request.price - route.base_price),
            6,
        )
        for quantile in QUANTILES
    }
    median_demand = demand["0.5"]
    sales = min(forecast.seats, max(0.0, median_demand))
    return {
        "source": FORECAST_FILENAME,
        "route": route.code,
        "route_name": route.name,
        "date": request.date.isoformat(),
        "price": request.price,
        "base_price": route.base_price,
        "price_sensitivity": route.price_sensitivity,
        "seats": forecast.seats,
        "demand": demand,
        "median_demand": median_demand,
        "predicted_sales": round(sales, 6),
    }


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                "Angular frontend ещё не собран. Выполните npm run build "
                "в frontend."
            ),
        )
    return FileResponse(index_path)


if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
