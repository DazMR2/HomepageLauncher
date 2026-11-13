# Homepage Launcher

A Windows desktop launcher for website tiles and local applications. Website tiles open in the default browser or (optionally) in a chrome-less launcher window; the Apps row can open installed Microsoft 365 apps, Teams, Copilot, or other `.exe`/`.lnk` applications.

## Run

1. Install Node.js 22 or later.
2. In this folder, run `npm install`.
3. Run `npm start`.

To build the Windows app, run `npm run dist`. Open `release\win-unpacked\Homepage Launcher.exe`; keep the full `win-unpacked` folder together.

Your tiles and snapshots are stored locally in the app's Electron user-data folder. A new website tile captures a thumbnail when it is added; use **Refresh snapshots** to recapture tiles. A site may block thumbnail capture, for example when it requires a sign-in or disallows embedded browsing.

The Office, Outlook, Word, Excel, and PowerPoint shortcuts use installed Office executables when found, and fall back to their web apps otherwise. Teams uses its registered Windows app link; Microsoft 365 and Copilot open in the default browser. Use **Add local app** to browse to an `.exe` or `.lnk` file, or **Scan folders** to detect app files and choose which ones to add.

Create custom groups from **Add group**, then assign both app shortcuts and website tiles to those groups when you add them. App tiles use square, color-filled cards matching the website tile style and show application icons. Use **Background color** from the top bar to change and save the dashboard background.

Use **Full screen** to toggle immersive mode on/off. You can optionally choose a custom image thumbnail per website and a custom icon per app. The dashboard is navigable with mouse, keyboard arrows, and Xbox controller (D-pad/left stick to move focus, A to activate).
If multiple input devices appear, use **Controller: Auto** in the top bar to cycle and lock to the intended controller slot, then click again to return to Auto.
When adding or editing a website tile, enable **Open inside launcher window** to open that site in a standalone launcher window with no browser chrome.

The dashboard runs in its own desktop window. Website tiles open in the default browser; the app does not change your browser's homepage setting.
