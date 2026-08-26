/**
 * Add this file to the SAME Apps Script project as the working PDGA contest sheet.
 *
 * Deploy as a Web app:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * The GitHub Pages frontend uses JSONP, so this works without browser CORS issues.
 */
function doGet(e) {
  const requested = e && e.parameter ? String(e.parameter.callback || '') : '';
  const callback = /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(requested)
    ? requested
    : '__pdgaPicksReceive';

  let refreshWarning = '';

  // Keep the public webpage much closer to PDGA Live than the normal
  // 1-minute Sheet trigger. Across all viewers, allow at most one fresh
  // PDGA pull every 20 seconds.
  try {
    refreshContestForWeb_();
  } catch (error) {
    // If PDGA has a temporary problem, still return the latest Sheet snapshot.
    refreshWarning = error && error.message ? error.message : String(error);
  }

  let payload;
  try {
    payload = getContestWebPayload_();
    if (refreshWarning) payload.refreshWarning = refreshWarning;
  } catch (error) {
    payload = {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }

  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function refreshContestForWeb_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pdga_picks_web_refresh';

  if (cache.get(cacheKey)) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) return;

  try {
    // Check again after obtaining the lock because another viewer may have
    // completed a refresh while this request was waiting.
    if (cache.get(cacheKey)) return;

    if (typeof refreshScores !== 'function') {
      throw new Error('refreshScores() was not found in this Apps Script project.');
    }

    refreshScores();
    cache.put(cacheKey, String(Date.now()), 20);
  } finally {
    lock.releaseLock();
  }
}

function getContestWebPayload_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Contest');
  if (!sheet) throw new Error('Contest sheet not found.');

  const standings = sheet.getRange(3, 1, 3, 5).getValues()
    .filter(row => row[1])
    .map(row => ({
      rank: valueOrNull_(row[0]),
      entrant: String(row[1] || ''),
      contestTotal: numericOrNull_(row[2]),
      droppedPlayer: String(row[3] || ''),
      droppedScore: numericOrNull_(row[4])
    }));

  const headerRow = 8;
  const firstDataRow = 9;
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const headerMap = {};
  headers.forEach((header, i) => {
    if (header) headerMap[String(header).trim()] = i;
  });

  const numRows = Math.max(0, Math.min(15, sheet.getLastRow() - firstDataRow + 1));
  const raw = numRows
    ? sheet.getRange(firstDataRow, 1, numRows, sheet.getLastColumn()).getValues()
    : [];

  const idx = name => Object.prototype.hasOwnProperty.call(headerMap, name) ? headerMap[name] : -1;
  const cell = (row, name) => idx(name) >= 0 ? row[idx(name)] : '';

  const players = raw
    .filter(row => cell(row, 'Entrant') && cell(row, 'Player'))
    .map(row => ({
      entrant: String(cell(row, 'Entrant') || ''),
      player: String(cell(row, 'Player') || ''),
      rounds: [1,2,3,4,5].map(n => numericOrNull_(cell(row, 'R' + n))),
      total: numericOrNull_(cell(row, 'Total')),
      currentRound: numericOrNull_(cell(row, 'Current Rd')),
      thru: String(cell(row, 'Thru') || '-'),
      place: String(cell(row, 'Place') || ''),
      updated: dateIsoOrNull_(cell(row, 'Updated')),
      drop: String(cell(row, 'Drop?') || '').toUpperCase() === 'DROP'
    }));

  const updatedTimes = players
    .map(p => p.updated)
    .filter(Boolean)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite);

  const currentRounds = players
    .map(p => Number(p.currentRound))
    .filter(Number.isFinite);

  return {
    ok: true,
    eventId: '97344',
    division: 'MPO',
    currentRound: currentRounds.length ? Math.max.apply(null, currentRounds) : 1,
    updatedAt: updatedTimes.length ? new Date(Math.max.apply(null, updatedTimes)).toISOString() : new Date().toISOString(),
    standings,
    players
  };
}

function numericOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function valueOrNull_(value) {
  return value === '' || value === null || value === undefined ? null : value;
}

function dateIsoOrNull_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}