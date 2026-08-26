# PDGA Picks

Mobile-first live standings for the 2026 PDGA Pro Worlds picks contest.

## Contest
- Event: PDGA #97344
- Division: MPO
- Entrants: Ben, Nathan, Tyler
- Five players per entrant
- Worst cumulative player score is dropped
- Standings and each entrant's players sort automatically

## 1. Connect the existing Google Sheet

The working Google Sheet remains the server-side PDGA score fetcher.

1. Open the Sheet's **Extensions → Apps Script**.
2. Add a new script file.
3. Copy the contents of **apps-script-web-endpoint.gs** from this repository into that file.
4. Save.
5. Choose **Deploy → New deployment**.
6. Select **Web app**.
7. Set **Execute as:** Me.
8. Set **Who has access:** Anyone.
9. Deploy and copy the URL ending in `/exec`.

Put that URL in `config.js`:

```js
window.PDGA_PICKS_API_URL = "YOUR_APPS_SCRIPT_EXEC_URL";
```

The public page then reads the already-refreshed Sheet through JSONP and refreshes itself every 30 seconds.

## 2. Turn on GitHub Pages

In this repository:

**Settings → Pages → Build and deployment → Deploy from a branch**

Choose:
- Branch: **main**
- Folder: **/(root)**

The site will be available at:

**https://tylerjhanson.github.io/pdga-picks/**

## Files

- `index.html` — responsive public contest page
- `config.js` — Apps Script endpoint URL
- `apps-script-web-endpoint.gs` — bridge from the working Sheet to the webpage
