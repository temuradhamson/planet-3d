# Планета

Интерактивный 3D-глобус: точные границы стран, области по всему миру, города, детальные районы Казахстана, Узбекистана и Таджикистана, демография при наведении, реальное Солнце и Луна, звёздная карта NASA SVS, синхронизированная с вращением.

## Где смотреть

- Прод на сервере СИНДИ: https://syndi.aigermes.uz/planet/
- GitHub Pages: https://temuradhamson.github.io/planet-3d/

Статика лежит на хабе `aigermes-uz` в `/srv/s3/caddy/planet-3d`, Caddy отдаёт `/planet/` отдельно от compose СИНДИ.

## Запуск локально

```bash
npm install
npm run dev
```

Открыть http://127.0.0.1:5173/

## Управление

- ЛКМ — вращать
- колесо / кнопки `+` `−` — зум
- `CA` — Центральная Азия
- поиск — страна, область, город, район
- ход времени — от паузы до «сутки за 12 секунд», чтобы увидеть терминатор

## Данные

- Страны: Natural Earth 50m (общественное достояние)
- Области мира: Natural Earth 10m admin-1; города: NE 10m populated places
- KZ / UZ / TJ ADM1–ADM2: [geoBoundaries](https://www.geoboundaries.org/) CC-BY 4.0
- Текстуры Земли: Solar System Scope (CC-BY 4.0) + city lights / normal / spec three.js
- Звёздная карта: NASA SVS 4851 Deep Star Maps 2020, экваториальная проекция
- Солнце и Луна: [astronomy-engine](https://github.com/cosinekitty/astronomy) по текущему времени (часовой пояс карточки — Asia/Tashkent, UTC+5)

Демография стран — оценки Natural Earth (`POP_EST`, `GDP_MD`) плюс карточки по Центральной Азии. Границы ADM1 Казахстана отражают нарезку до реформы 2022 года (без отдельных Абай / Жетысу / Улытау).
