# Решись Авиа — калькулятор продаж

Веб-приложение для оценки спроса на авиабилеты при выбранной цене. Backend
на FastAPI рассчитывает спрос по девяти квантилям, а Angular frontend
показывает медианный спрос, прогноз продаж и график.

## Возможности

- выбор одного из пяти маршрутов и даты рейса;
- расчёт спроса для цены в рублях;
- ограничение прогнозных продаж вместимостью самолёта;
- график девяти сценариев спроса и линии вместимости;
- отображение источника прогноза;
- переключение на собственный CSV через `FORECAST_FILENAME`.

## Требования

- Python 3.11 или новее;
- Node.js 18 или новее и npm.

## Быстрый запуск

Все команды ниже выполняются из каталога `development`.

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload
```

Backend будет доступен по адресу http://127.0.0.1:8000. Документация API:
http://127.0.0.1:8000/docs.

### Frontend в режиме разработки

В отдельном окне PowerShell:

```powershell
Set-Location frontend
npm ci
npm start
```

Откройте http://localhost:4200. Angular proxy направляет запросы `/flights`
и `/predict` на backend по адресу `http://127.0.0.1:8000`.

### Сборка и запуск одним адресом

```powershell
Set-Location frontend
npm ci
npm run build
Set-Location ..
python -m uvicorn backend.main:app --reload
```

После сборки приложение открывается на http://127.0.0.1:8000.

## API

### `GET /flights`

Возвращает имя файла прогноза и список доступных рейсов:

```json
{
  "source": "seasonal_forecast.csv",
  "flights": [
    {
      "route": "MOW-AER",
      "name": "Москва — Сочи",
      "origin": "Москва",
      "destination": "Сочи",
      "date": "2026-06-12",
      "base_price": 8500
    }
  ]
}
```

### `POST /predict`

Пример запроса:

```json
{
  "route": "MOW-AER",
  "date": "2026-06-12",
  "price": 9000
}
```

Для каждого квантиля сервер вычисляет:

```text
demand(q) = q_base_demand - price_sensitivity * (price - base_price)
sales = min(seats, max(0, demand(0.5)))
```

Цена должна быть положительной и указана с точностью до копейки. Неизвестный
маршрут или дата дают ответ `404`, некорректные параметры — `422`.

## Данные и собственный прогноз

Стандартные файлы находятся в `data/`:

- `routes.csv` — справочник маршрутов, цены и чувствительность спроса;
- `seasonal_forecast.csv` — 155 строк прогноза для пяти маршрутов с 1 июня
  по 1 июля 2026 года.

Чтобы проверить собственный прогноз, положите CSV в `data/` и задайте имя
файла до запуска backend:

```powershell
$env:FORECAST_FILENAME = "ФИО_my_forecast.csv"
python -m uvicorn backend.main:app --reload
```

CSV должен содержать те же столбцы, что и `seasonal_forecast.csv`, включая
девять полей `{0.1,...,0.9}_base_demand`. Дубликаты рейсов, пропущенные
столбцы, неизвестные маршруты и нечисловые значения отклоняются при старте
сервера.

## Развёртывание

Для хостинга с поддержкой Python:

1. установите зависимости из `requirements.txt`;
2. соберите frontend командой `npm ci; npm run build` из `frontend`;
3. запустите приложение командой:

```text
uvicorn backend.main:app --host 0.0.0.0 --port $PORT
```

Собранный frontend должен находиться в `frontend/dist/browser`. Переменная
`PORT` задаётся платформой хостинга.
