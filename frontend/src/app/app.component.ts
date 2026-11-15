import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Subscription } from 'rxjs';

interface Flight {
  route: string;
  name: string;
  origin: string;
  destination: string;
  date: string;
  base_price: number;
}

interface FlightsResponse {
  source: string;
  flights: Flight[];
}

interface PredictionResponse {
  source: string;
  route: string;
  route_name: string;
  date: string;
  price: number;
  base_price: number;
  price_sensitivity: number;
  seats: number;
  demand: Record<string, number>;
  median_demand: number;
  predicted_sales: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="shell">
      <header class="hero">
        <h1>Проверьте продажи до публикации тарифа</h1>
        <p class="subtitle">Выберите рейс и цену — калькулятор покажет медианный спрос и девять сценариев.</p>
      </header>

      <section class="workspace">
        <form class="card form-card" (ngSubmit)="submit(priceInput.validity.valid)" #calculatorForm="ngForm">
          <div class="card-heading">
            <div>
              <p class="eyebrow">ПАРАМЕТРЫ РЕЙСА</p>
              <h2>Новый расчёт</h2>
            </div>
          </div>

          <div class="form-grid">
            <div>
              <label for="origin">Откуда</label>
              <select id="origin" name="origin" [(ngModel)]="selectedOrigin" (ngModelChange)="syncFlightSelection()" required>
                <option value="" disabled>Город отправления</option>
                <option *ngFor="let origin of origins" [value]="origin">{{ origin }}</option>
              </select>
            </div>
            <div>
              <label for="destination">Куда</label>
              <select id="destination" name="destination" [(ngModel)]="selectedDestination" (ngModelChange)="syncFlightSelection()" required>
                <option value="" disabled>Город прибытия</option>
                <option *ngFor="let destination of destinations" [value]="destination">{{ destination }}</option>
              </select>
            </div>
          </div>

          <label for="flight-date">Дата рейса</label>
          <select id="flight-date" name="flight-date" [(ngModel)]="selectedDate" (ngModelChange)="syncFlightSelection()" required>
            <option value="" disabled>Выберите дату</option>
            <option *ngFor="let flight of matchingFlights" [value]="flight.date">{{ flight.date }}</option>
          </select>

          <label for="price">Цена билета, ₽</label>
          <div class="price-input">
            <input id="price" name="price" type="number" #priceInput #priceModel="ngModel" [(ngModel)]="price" (input)="resetResult()"
                   min="0.01" step="0.01" required aria-describedby="price-hint">
            <span>₽</span>
          </div>
          <p class="error" role="alert" *ngIf="(priceModel.dirty || priceModel.touched) && !priceInput.validity.valid">
            Введите положительную цену в рублях с точностью до копейки.
          </p>
          <p id="price-hint" class="hint" *ngIf="selectedFlight">Базовая цена: {{ selectedFlight.base_price | number:'1.0-2' }} ₽</p>

          <button type="submit" [disabled]="loading || calculatorForm.invalid || !priceInput.validity.valid">
            {{ loading ? 'Считаем…' : 'Рассчитать спрос' }}
          </button>
          <p class="error" *ngIf="flightsError">{{ flightsError }}</p>
          <p class="error" *ngIf="errorMessage">{{ errorMessage }}</p>
        </form>

        <section class="card result-card" *ngIf="prediction; else emptyState">
          <div class="card-heading">
            <div>
              <p class="eyebrow">РЕЗУЛЬТАТ</p>
              <h2>{{ prediction.route_name }}</h2>
              <div class="result-meta">
                <time [attr.datetime]="prediction.date">{{ prediction.date }}</time>
                <span>Спрос при цене {{ prediction.price | number:'1.2-2' }} ₽</span>
              </div>
            </div>
          </div>
          <div class="metrics">
            <div><span>Мест</span><strong>{{ prediction.seats | number:'1.0-0' }}</strong></div>
            <div><span>Желающих по медиане</span><strong>{{ prediction.median_demand | number:'1.0-6' }}</strong></div>
            <div class="accent"><span>Купят по прогнозу</span><strong>{{ prediction.predicted_sales | number:'1.0-0' }}</strong></div>
          </div>
          <div class="chart-wrap" aria-label="График спроса по квантилям">
            <div class="chart-label">
              <span class="chart-legend"><i class="legend-demand"></i>спрос <i class="legend-capacity"></i>вместимость</span>
            </div>
            <div class="chart-scroll">
              <svg viewBox="0 0 640 290" role="group" aria-label="Спрос по квантилям">
                <line x1="64" y1="24" x2="64" y2="242" class="axis"></line>
                <line x1="64" [attr.y1]="chartY(0)" x2="620" [attr.y2]="chartY(0)" class="axis"></line>
                <text x="16" y="135" text-anchor="middle" class="axis-label" transform="rotate(-90 16 135)">Количество желающих купить билет</text>
                <ng-container *ngFor="let tick of chartTicks">
                  <text x="58" [attr.y]="chartY(tick) + 4" text-anchor="end">{{ tick | number:'1.0-2' }}</text>
                </ng-container>
                <line x1="64" [attr.y1]="chartY(prediction.seats)" x2="620" [attr.y2]="chartY(prediction.seats)" class="capacity"></line>
                <polyline [attr.points]="chartPoints" class="demand-line"></polyline>
                <ng-container *ngFor="let q of quantiles">
                  <g tabindex="0" [attr.aria-label]="'Квантиль ' + (q | number:'1.1-1') + ', спрос ' + (prediction.demand[q] | number:'1.0-6')"
                     (mouseenter)="activeQuantile = q" (focus)="activeQuantile = q" (click)="activeQuantile = q">
                    <circle [attr.cx]="chartX(q)" [attr.cy]="chartY(prediction.demand[q])" r="12" class="hit-area"></circle>
                    <circle [attr.cx]="chartX(q)" [attr.cy]="chartY(prediction.demand[q])" [class.median]="q === '0.5'" r="5"></circle>
                  </g>
                  <text [attr.x]="chartX(q)" y="265" text-anchor="middle">{{ q | number:'1.1-1' }}</text>
                </ng-container>
                <text x="334" y="286" text-anchor="middle" class="axis-label">Квантиль прогноза</text>
                <text x="610" [attr.y]="chartY(prediction.seats) - 8" text-anchor="end" class="capacity-label">Вместимость: {{ prediction.seats | number:'1.0-0' }}</text>
              </svg>
            </div>
            <p aria-live="polite">Квантиль {{ activeQuantile | number:'1.1-1' }} · Спрос: {{ prediction.demand[activeQuantile] | number:'1.0-6' }} чел.</p>
            <p class="chart-note">Оранжевая точка 0,5 — медианный спрос, который используется в карточке и расчёте продаж.</p>
          </div>
        </section>
        <ng-template #emptyState>
          <section class="card empty-state">
            <h2>Расчёт появится здесь</h2>
            <p>Укажите рейс и цену, чтобы увидеть медианный прогноз продаж и график сценариев.</p>
          </section>
        </ng-template>
      </section>
      <footer class="site-footer">
        <span>Динамическое ценообразование авиабилетов</span>
        <a href="https://github.com/ProstoSaniok/reshis26-dev" target="_blank" rel="noreferrer">Репозиторий ↗</a>
      </footer>
    </main>
  `,
})
export class AppComponent implements OnInit {
  private readonly http = inject(HttpClient);
  flights: Flight[] = [];
  selectedFlight?: Flight;
  private request?: Subscription;
  activeQuantile = '0.5';
  readonly quantiles = Array.from({ length: 9 }, (_, i) => ((i + 1) / 10).toFixed(1));
  selectedOrigin = '';
  selectedDestination = '';
  selectedDate = '';
  price: number | null = null;
  loading = false;
  flightsError = '';
  errorMessage = '';
  prediction: PredictionResponse | null = null;

  ngOnInit(): void {
    this.http.get<FlightsResponse>('/flights').subscribe({
      next: (response) => {
        this.flightsError = '';
        this.flights = response.flights;
        if (this.flights.length > 0) {
          this.selectedOrigin = this.flights[0].origin;
          this.selectedDestination = this.flights[0].destination;
          this.selectedDate = this.flights[0].date;
          this.syncFlightSelection();
        }
      },
      error: () => (this.flightsError = 'Не удалось загрузить список рейсов. Проверьте запуск API.'),
    });
  }

  get origins(): string[] {
    return [...new Set(this.flights.map((flight) => flight.origin))];
  }

  get destinations(): string[] {
    return [...new Set(this.flights.filter((flight) => flight.origin === this.selectedOrigin).map((flight) => flight.destination))];
  }

  get matchingFlights(): Flight[] {
    return this.flights.filter((flight) => flight.origin === this.selectedOrigin && flight.destination === this.selectedDestination);
  }

  syncFlightSelection(): void {
    const availableDestinations = this.destinations;
    if (!availableDestinations.includes(this.selectedDestination)) {
      this.selectedDestination = availableDestinations[0] ?? '';
    }
    const matchingFlights = this.matchingFlights;
    const match = matchingFlights.find((flight) => flight.date === this.selectedDate) ?? matchingFlights[0];
    if (this.selectedFlight?.route !== match?.route) {
      this.price = match?.base_price ?? null;
    }
    this.selectedFlight = match;
    this.selectedDate = match?.date ?? '';
    this.resetResult();
  }

  resetResult(): void {
    this.request?.unsubscribe();
    this.loading = false;
    this.prediction = null;
    this.activeQuantile = '0.5';
    this.errorMessage = '';
  }

  submit(validPrice: boolean): void {
    const flight = this.selectedFlight;
    if (!flight || !validPrice || this.price === null || !Number.isFinite(this.price) || this.price <= 0) {
      this.errorMessage = 'Выберите рейс и укажите положительную цену.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.prediction = null;
    this.request = this.http.post<PredictionResponse>('/predict', {
      route: flight.route,
      date: flight.date,
      price: this.price,
    }).subscribe({
      next: (response) => {
        this.prediction = response;
        this.loading = false;
      },
      error: (error) => {
        const detail = error.error?.detail;
        if (Array.isArray(detail)) {
          const labels: Record<string, string> = { route: 'Маршрут', date: 'Дата рейса', price: 'Цена билета' };
          this.errorMessage = detail.map(issue => {
            const field = issue.loc?.[issue.loc.length - 1];
            if (field === 'price') return 'Введите положительную цену в рублях с точностью до копейки.';
            return (labels[field] ?? field ?? 'Параметры') + ': ' + issue.msg;
          }).join(' ');
        } else {
          this.errorMessage = typeof detail === 'string' ? detail : 'Расчёт не выполнен. Проверьте параметры.';
        }
        this.loading = false;
      },
    });
  }

  get chartPoints(): string {
    if (!this.prediction) return '';
    return Object.entries(this.prediction.demand)
      .map(([q, value]) => `${this.chartX(q)},${this.chartY(value)}`).join(' ');
  }

  chartX(quantile: string): number {
    return 64 + Number(quantile) * 556;
  }

  get chartTicks(): number[] {
    if (!this.prediction) return [0, 1];
    const values = Object.values(this.prediction.demand);
    const min = Math.min(0, ...values);
    const max = Math.max(1, this.prediction.seats, ...values);
    const step = Math.max(1, Math.ceil((max - min) / 4));
    const first = Math.floor(min / step);
    const last = Math.ceil(max / step);
    return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
  }

  chartY(value: number): number {
    const ticks = this.chartTicks;
    const min = ticks[0];
    const max = ticks[ticks.length - 1];
    return 242 - ((value - min) / (max - min)) * 205;
  }
}
