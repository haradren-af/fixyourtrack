FixYourTrack for macOS
=====================

Fix damaged GPS track sections in a local browser app.
No installation, Node.js, Python, or additional libraries are required.
Both Apple Silicon and Intel Macs are supported.

START
1. Extract the entire FixYourTrack-macOS folder from the ZIP archive.
2. On first launch, Control-click "Start FixYourTrack.command" and choose Open.
3. Your default browser opens the app.
4. Read "TESTING-CHECKLIST.txt" for suggested checks.

STOP
Double-click "Stop FixYourTrack.command".

REQUIREMENTS
- macOS 12 or newer
- A modern browser
- Internet access for maps, routing, satellite imagery, and elevation correction

PRIVACY
- Track files stay in your browser.
- Applied repairs are saved as a local browser draft.
- Public map, routing, and terrain services receive coordinate requests required
  for their features.

TROUBLESHOOTING
- Keep the complete extracted folder together.
- This tester build is not signed with an Apple Developer certificate.
- If macOS blocks the local server, open System Settings > Privacy & Security,
  verify the source, and choose Open Anyway.
- If the browser does not open, run "Start FixYourTrack.command" again.
- Technical startup details are written to runtime/server.log.


FixYourTrack для macOS
=====================

Локальное приложение для исправления поврежденных участков GPS-треков.
Установка Node.js, Python и дополнительных библиотек не требуется.
Поддерживаются Mac с Apple Silicon и Intel.

ЗАПУСК
1. Полностью распакуйте папку FixYourTrack-macOS из ZIP-архива.
2. При первом запуске нажмите на "Start FixYourTrack.command" с удержанием
   Control и выберите "Открыть".
3. Приложение откроется в браузере по умолчанию.
4. Откройте "TESTING-CHECKLIST.txt", чтобы увидеть список проверок.

ОСТАНОВКА
Дважды нажмите "Stop FixYourTrack.command".

ТРЕБОВАНИЯ
- macOS 12 или новее
- Современный браузер
- Интернет для карт, маршрутизации, спутниковых снимков и коррекции высоты

КОНФИДЕНЦИАЛЬНОСТЬ
- Файлы треков остаются в браузере.
- Примененные исправления сохраняются в локальном черновике браузера.
- Публичные сервисы карт, маршрутизации и рельефа получают координаты,
  необходимые для работы этих функций.

РЕШЕНИЕ ПРОБЛЕМ
- Не перемещайте отдельные файлы из распакованной папки.
- Тестовая сборка не подписана сертификатом Apple Developer.
- Если macOS блокирует локальный сервер, откройте Системные настройки >
  Конфиденциальность и безопасность, проверьте источник и выберите
  "Все равно открыть".
- Если браузер не открылся, снова запустите "Start FixYourTrack.command".
- Технический журнал запуска находится в runtime/server.log.
