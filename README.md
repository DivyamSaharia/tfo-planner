# TFO Planner

Day-by-day yarn and TFO planning for Hanuman Weavelon Unit 2. Live at https://divyamsaharia.github.io/tfo-planner/

- Plain HTML, CSS and JS modules, no build step. GitHub Pages serves the repo root from `main`.
- Data: the Fabric Master DB Google Sheet, through the planner's own Apps Script web app (POST, JSON body sent as `text/plain`). The key is entered once in Settings and kept on the device.
- Reads the master tabs (Units, LoomGroups, Fabrics, Assignments, FabricYarns, Yarns, FabricBeams, TfoTypes, TfoSpeeds). Writes the Planner tabs, plus loom RPM on Fabrics and efficiency, doff size and spindles per side on TfoTypes.
- Screens: Looms, Production, Running today, Machine changeover, Yarn requirement, Beam stock, Yarn stock, Receipts from outside, TFO machines, Stock and deficit, RPM master; Masters (view only): Fabric master, Yarn master.
- Beam balance: the entered balance is at the start of its balance date; production metres × (1 + warp shortage) dated on or after it are taken off, and the run-out forecast starts the day after the last production entry.

## Files

- `js/calc.js` all calculations (no DOM). TFO RPM in TfoSpeeds is already x2 and is never doubled.
- `js/app.js` screens, editing and saving. `js/picker.js` the searchable yarn picker. `js/api.js` talks to Apps Script. `js/sample.js` builds the sample starting position (ids start with `smp_`).
- `apps-script/Code.gs` copy of the deployed Apps Script.
- `test/` node tests for the check values: `npm test` (Node 18+).

## Change the app

Edit the files, run `npm test`, commit and push to `main`. Pages updates in about a minute. Bump `CACHE` in `sw.js` when changing files so phones pick up the new version.
