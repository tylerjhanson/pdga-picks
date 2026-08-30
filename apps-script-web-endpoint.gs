/**
 * Web endpoint for the standalone PDGA Picks page.
 *
 * Add this file to the SAME Apps Script project as the working contest Sheet.
 *
 * Deploy as a Web app:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * IMPORTANT FOR 2026 PRO WORLDS:
 * PDGA identifies the fifth/final round as API Round=12 ("Finals"), not Round=5.
 * This bridge maps PDGA Round 12 -> contest R5.
 */

const WEB_PICKS_ = [
  { entrant: 'Ben',    player: 'Ricky Wysocki',    pdga: '38008', aliases: ['Richard Wysocki', 'Ricky Wysocki'] },
  { entrant: 'Ben',    player: 'Isaac Robinson',   pdga: '50670', aliases: ['Isaac Robinson'] },
  { entrant: 'Ben',    player: 'Evan Smith',       pdga: '101574', aliases: ['Evan Smith'] },
  { entrant: 'Ben',    player: 'Luke Taylor',      pdga: '102119', aliases: ['Luke Taylor'] },
  { entrant: 'Ben',    player: 'Kyle Klein',       pdga: '85132', aliases: ['Kyle Klein'] },

  { entrant: 'Nathan', player: 'Niklas Anttila',   pdga: '91249', aliases: ['Niklas Anttila', 'Niklas Antilla'] },
  { entrant: 'Nathan', player: 'Gannon Buhr',      pdga: '75412', aliases: ['Gannon Buhr'] },
  { entrant: 'Nathan', player: 'Ezra Robinson',    pdga: '50671', aliases: ['Ezra Robinson'] },
  { entrant: 'Nathan', player: 'Sullivan Tipton',  pdga: '78817', aliases: ['Sullivan Tipton'] },
  { entrant: 'Nathan', player: 'Cole Redalen',     pdga: '79748', aliases: ['Cole Redalen'] },

  { entrant: 'Tyler',  player: 'Calvin Heimburg',  pdga: '45971', aliases: ['Calvin Heimburg'] },
  { entrant: 'Tyler',  player: 'Eagle McMahon',    pdga: '37817', aliases: ['Eagle McMahon'] },
  { entrant: 'Tyler',  player: 'Simon Lizotte',    pdga: '8332', aliases: ['Simon Lizotte'] },
  { entrant: 'Tyler',  player: 'Adam Hammes',      pdga: '57365', aliases: ['Adam Hammes'] },
  { entrant: 'Tyler',  player: 'Anthony Barela',   pdga: '44382', aliases: ['Anthony Barela'] }
];

function doGet(e) {
  const requested = e && e.parameter ? String(e.parameter.callback || '') : '';
  const callback = /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(requested)
    ? requested
    : '__pdgaPicksReceive';

  let refreshWarning = '';

  try {
    web_refreshContest_();
  } catch (error) {
    refreshWarning = error && error.message ? error.message : String(error);
  }

  let payload;

  try {
    payload = web_getSheetPayload_();

    // PDGA's final round is special: Round=12 is "Finals".
    // Overlay that feed onto the Sheet snapshot as contest R5.
    try {
      payload = web_applyFinalsRound12_(payload);
    } catch (finalsError) {
      if (!refreshWarning) {
        refreshWarning = finalsError && finalsError.message
          ? finalsError.message
          : String(finalsError);
      }
    }

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

function web_refreshContest_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pdga_picks_web_refresh';

  if (cache.get(cacheKey)) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) return;

  try {
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

function web_getSheetPayload_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Contest');
  if (!sheet) throw new Error('Contest sheet not found.');

  const standings = sheet.getRange(3, 1, 3, 5).getValues()
    .filter(row => row[1])
    .map(row => ({
      rank: web_valueOrNull_(row[0]),
      entrant: String(row[1] || ''),
      contestTotal: web_numericOrNull_(row[2]),
      droppedPlayer: String(row[3] || ''),
      droppedScore: web_numericOrNull_(row[4])
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
    .map((row, order) => ({
      entrant: String(cell(row, 'Entrant') || ''),
      player: String(cell(row, 'Player') || ''),
      rounds: [1,2,3,4,5].map(n => web_numericOrNull_(cell(row, 'R' + n))),
      total: web_numericOrNull_(cell(row, 'Total')),
      currentRound: web_numericOrNull_(cell(row, 'Current Rd')),
      thru: String(cell(row, 'Thru') || '-'),
      place: String(cell(row, 'Place') || ''),
      updated: web_dateIsoOrNull_(cell(row, 'Updated')),
      drop: String(cell(row, 'Drop?') || '').toUpperCase() === 'DROP',
      _order: order
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
    bridgeVersion: 'finals-v7',
    eventId: '97344',
    division: 'MPO',
    currentRound: currentRounds.length ? Math.max.apply(null, currentRounds) : 1,
    updatedAt: updatedTimes.length
      ? new Date(Math.max.apply(null, updatedTimes)).toISOString()
      : new Date().toISOString(),
    standings,
    players
  };
}

function web_applyFinalsRound12_(payload) {
  const finals = web_fetchFinalsRound12_();
  const scores = finals.scores || [];
  payload.finalsFeed = {
    detectedPlayers: scores.length,
    fetchedAt: finals.fetchedAt,
    sourceRound: finals.sourceRound || null,
    parser: finals.debug || ''
  };

  // If PDGA has not populated the Finals feed yet, keep the Sheet snapshot.
  if (!scores.length) return payload;

  const hasFinalsScoring = scores.some(player => {
    const played = web_number_(web_getField_(player, ['Played', 'played', 'HolesPlayed', 'holesPlayed']), 0);
    const completed = web_bool_(web_getField_(player, ['Completed', 'completed', 'IsComplete', 'isComplete']));
    const roundToPar = web_scoreNumber_(web_getField_(player, [
      'RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar', 'RdToPar', 'rdToPar'
    ]));
    return played > 0 || completed || (roundToPar !== null && roundToPar !== 0);
  });

  // The feed exists even before the first throw. Once it exists, this is contest R5.
  payload.currentRound = 5;

  payload.players.forEach((player, order) => {
    player._order = typeof player._order === 'number' ? player._order : order;
    const pick = web_findPick_(player.entrant, player.player);
    if (!pick) return;

    let feedPlayer = null;

    // Use the same player matcher as the working R1-R4 Sheet whenever available.
    // It matches PDGA number first, then flexible name/alias variants.
    if (typeof findPlayer_ === 'function') {
      feedPlayer = findPlayer_(scores, pick);
    }

    // Fallback for a standalone endpoint file.
    if (!feedPlayer) {
      feedPlayer = scores.find(p => {
        const pdga = web_getPdgaNumber_(p);
        if (pdga && String(pdga) === String(pick.pdga)) return true;

        const candidate = web_getField_(p, [
          'Name', 'name', 'PlayerName', 'playerName',
          'FullName', 'fullName', 'ShortName', 'shortName'
        ]);

        return [pick.player].concat(pick.aliases || [])
          .some(alias => web_namesMatch_(candidate, alias));
      }) || null;
    }

    player.currentRound = 5;

    if (!feedPlayer) {
      // Not present in Finals feed = did not advance to the final round.
      player.thru = 'CUT';
      player.place = player.place || '';
      return;
    }

    const played = typeof number_ === 'function' && typeof getField_ === 'function'
      ? number_(getField_(feedPlayer, ['Played', 'played', 'HolesPlayed', 'holesPlayed']), 0)
      : web_number_(web_getField_(feedPlayer, ['Played', 'played', 'HolesPlayed', 'holesPlayed']), 0);

    const holes = typeof number_ === 'function' && typeof getField_ === 'function'
      ? number_(getField_(feedPlayer, ['Holes', 'holes', 'TotalHoles', 'totalHoles']), 18)
      : web_number_(web_getField_(feedPlayer, ['Holes', 'holes', 'TotalHoles', 'totalHoles']), 18);

    const completed = typeof bool_ === 'function' && typeof getField_ === 'function'
      ? bool_(getField_(feedPlayer, ['Completed', 'completed', 'IsComplete', 'isComplete']))
      : web_bool_(web_getField_(feedPlayer, ['Completed', 'completed', 'IsComplete', 'isComplete']));

    const roundToPar = typeof scoreNumber_ === 'function' && typeof getField_ === 'function'
      ? scoreNumber_(getField_(feedPlayer, ['RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar', 'RdToPar', 'rdToPar']))
      : web_scoreNumber_(web_getField_(feedPlayer, ['RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar', 'RdToPar', 'rdToPar']));

    const cumulative = typeof scoreNumber_ === 'function' && typeof getField_ === 'function'
      ? scoreNumber_(getField_(feedPlayer, ['ToPar', 'toPar', 'topar', 'TotalToPar', 'totalToPar', 'Total']))
      : web_scoreNumber_(web_getField_(feedPlayer, ['ToPar', 'toPar', 'topar', 'TotalToPar', 'totalToPar', 'Total']));

    // Only put a number into R5 after the player has actually started.
    if (played > 0 || completed) {
      if (roundToPar !== null) {
        player.rounds[4] = roundToPar;
      } else if (cumulative !== null) {
        // Finals feeds can differ from normal rounds. If PDGA gives us the
        // cumulative tournament score but not RoundtoPar, derive R5 from the
        // four completed rounds already stored in the Sheet.
        const priorRounds = (player.rounds || []).slice(0, 4);
        if (
          priorRounds.length === 4 &&
          priorRounds.every(value => typeof value === 'number' && Number.isFinite(value))
        ) {
          player.rounds[4] =
            cumulative - priorRounds.reduce((sum, value) => sum + value, 0);
        }
      }
    }

    // ToPar is the correct cumulative tournament total for finalists.
    if (cumulative !== null) {
      player.total = cumulative;
    }

    player.thru = completed || played >= holes
      ? 'F'
      : (played > 0 ? String(played) : '-');

    const runningPlace = typeof getField_ === 'function'
      ? getField_(feedPlayer, ['RunningPlace', 'runningPlace', 'Place', 'place', 'Position', 'position'])
      : web_getField_(feedPlayer, ['RunningPlace', 'runningPlace', 'Place', 'place', 'Position', 'position']);

    if (runningPlace !== null && runningPlace !== undefined && runningPlace !== '') {
      const tied = typeof bool_ === 'function' && typeof getField_ === 'function'
        ? bool_(getField_(feedPlayer, ['Tied', 'tied', 'IsTied', 'isTied']))
        : web_bool_(web_getField_(feedPlayer, ['Tied', 'tied', 'IsTied', 'isTied']));
      player.place = (tied ? 'T' : '') + runningPlace;
    }

    player.updated = finals.fetchedAt;
  });

  // Once real Finals scoring has started, use the fresh fetch time.
  if (hasFinalsScoring) payload.updatedAt = finals.fetchedAt;

  payload.standings = web_recomputeStandings_(payload.players);

  // Keep the Sheet useful too. This writes R5 / Total / Round / Thru / Place
  // back to the existing rows after the old refreshScores() has run.
  try {
    web_writeFinalsToSheet_(payload);
  } catch (e) {
    // The public page should still work even if the Sheet write fails.
  }

  return payload;
}

function web_fetchFinalsRound12_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pdga_picks_finals_dynamic_v7';
  const cached = cache.get(cacheKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  // Do not assume the UI's ?round=12 is also the API round.
  // Ask PDGA event metadata first, then test both known candidates.
  let eventRound = null;

  try {
    if (
      typeof fetchEventRaw_ === 'function' &&
      typeof extractCurrentRoundFromEvent_ === 'function'
    ) {
      const eventResult = fetchEventRaw_();
      if (eventResult && eventResult.json) {
        eventRound = extractCurrentRoundFromEvent_(eventResult.json);
      }
    }
  } catch (e) {}

  // The event metadata can still report Round 4 during the special Finals
  // phase. Never allow that completed prior round to compete with today's
  // Finals feed. PDGA's two plausible Finals API identifiers are 12 and 5.
  const candidates = [12, 5];

  const attempts = [];

  candidates.forEach(round => {
    try {
      const result = fetchRoundRaw_(round);
      let scores = [];

      if (result && result.json) {
        let root = result.json;

        if (typeof unwrapJsonStrings_ === 'function') {
          root = unwrapJsonStrings_(root);
        }

        const data =
          root && typeof root === 'object' && !Array.isArray(root)
            ? (typeof getField_ === 'function'
                ? getField_(root, ['data'])
                : web_getField_(root, ['data']))
            : null;

        const directScores =
          data && typeof data === 'object' && !Array.isArray(data)
            ? (typeof getField_ === 'function'
                ? getField_(data, ['scores', 'Scores'])
                : web_getField_(data, ['scores', 'Scores']))
            : null;

        if (Array.isArray(directScores)) {
          scores = directScores;
        } else if (typeof extractScoreArray_ === 'function') {
          scores = extractScoreArray_(root) || [];
        } else {
          scores = web_extractScoreArray_(root);
        }
      }

      let activePlayers = 0;
      let matchedPicks = 0;
      let matchedActivePicks = 0;
      let totalPlayed = 0;

      (scores || []).forEach(player => {
        const played = typeof number_ === 'function' && typeof getField_ === 'function'
          ? number_(getField_(player, ['Played', 'played', 'HolesPlayed', 'holesPlayed']), 0)
          : web_number_(web_getField_(player, ['Played', 'played', 'HolesPlayed', 'holesPlayed']), 0);

        const completed = typeof bool_ === 'function' && typeof getField_ === 'function'
          ? bool_(getField_(player, ['Completed', 'completed', 'IsComplete', 'isComplete']))
          : web_bool_(web_getField_(player, ['Completed', 'completed', 'IsComplete', 'isComplete']));

        const roundToPar = typeof scoreNumber_ === 'function' && typeof getField_ === 'function'
          ? scoreNumber_(getField_(player, ['RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar', 'RdToPar', 'rdToPar']))
          : web_scoreNumber_(web_getField_(player, ['RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar', 'RdToPar', 'rdToPar']));

        // PDGA future/placeholder round feeds can contain RoundtoPar = 0
        // before anyone has started. Do NOT count that as live scoring.
        const active =
          played > 0 ||
          completed ||
          (roundToPar !== null && roundToPar !== 0);

        if (active) activePlayers++;
        totalPlayed += played;

        WEB_PICKS_.forEach(pick => {
          let matches = false;

          if (typeof findPlayer_ === 'function') {
            matches = findPlayer_([player], pick) === player;
          } else {
            const pdga = web_getPdgaNumber_(player);
            if (pdga && String(pdga) === String(pick.pdga)) {
              matches = true;
            } else {
              const candidateName = web_getField_(player, [
                'Name','name','PlayerName','playerName','FullName','fullName','ShortName','shortName'
              ]);
              matches = [pick.player].concat(pick.aliases || [])
                .some(alias => web_namesMatch_(candidateName, alias));
            }
          }

          if (matches) {
            matchedPicks++;
            if (active) matchedActivePicks++;
          }
        });
      });

      // Strongly prefer the round that contains LIVE scoring for our actual picks.
      // Finals selection must be based on TODAY'S live hole progress.
      // A feed with real holes played always beats a placeholder feed.
      const quality =
        (totalPlayed * 1000000) +
        (matchedActivePicks * 10000) +
        (activePlayers * 100) +
        matchedPicks;

      attempts.push({
        round: round,
        scores: scores || [],
        http: result && result.code,
        activePlayers: activePlayers,
        matchedPicks: matchedPicks,
        matchedActivePicks: matchedActivePicks,
        totalPlayed: totalPlayed,
        quality: quality
      });
    } catch (e) {
      attempts.push({
        round: round,
        scores: [],
        error: e && e.message ? e.message : String(e),
        activePlayers: 0,
        matchedPicks: 0,
        matchedActivePicks: 0,
        totalPlayed: 0,
        quality: -1
      });
    }
  });

  attempts.sort((a, b) => b.quality - a.quality);
  const best = attempts[0];

  if (!best || !best.scores || !best.scores.length || best.totalPlayed <= 0) {
    throw new Error(
      'Could not find a Finals feed with live holes played. Tried API rounds: ' +
      candidates.join(', ') +
      '. ' +
      attempts.map(a =>
        'R' + a.round +
        ': players=' + (a.scores ? a.scores.length : 0) +
        ', matched=' + a.matchedPicks +
        ', matchedActive=' + a.matchedActivePicks +
        ', holes=' + a.totalPlayed
      ).join(' | ')
    );
  }

  const result = {
    scores: best.scores,
    sourceRound: best.round,
    fetchedAt: new Date().toISOString(),
    debug:
      'eventRound=' + eventRound +
      '; chosen=' + best.round +
      '; matched=' + best.matchedPicks +
      '; matchedActive=' + best.matchedActivePicks +
      '; activePlayers=' + best.activePlayers +
      '; totalPlayed=' + best.totalPlayed
  };

  try {
    cache.put(cacheKey, JSON.stringify(result), 10);
  } catch (e) {}

  return result;
}

function web_recomputeStandings_(players) {
  const entrantOrder = ['Ben', 'Nathan', 'Tyler'];

  const standings = entrantOrder.map(entrant => {
    const group = players
      .filter(p => p.entrant === entrant)
      .map((p, i) => ({ ...p, _stable: typeof p._order === 'number' ? p._order : i }))
      .filter(p => typeof p.total === 'number' && Number.isFinite(p.total))
      .sort((a, b) => {
        if (a.total !== b.total) return a.total - b.total;
        return a._stable - b._stable;
      });

    if (group.length < 5) {
      return {
        entrant: entrant,
        contestTotal: null,
        droppedPlayer: '',
        droppedScore: null
      };
    }

    // Best-to-worst list. If worst is tied, the visually LAST tied player is dropped.
    const dropped = group[group.length - 1];
    const contestTotal = group.reduce((sum, p) => sum + p.total, 0) - dropped.total;

    return {
      entrant: entrant,
      contestTotal: contestTotal,
      droppedPlayer: dropped.player,
      droppedScore: dropped.total
    };
  });

  standings.sort((a, b) => {
    const aBlank = typeof a.contestTotal !== 'number';
    const bBlank = typeof b.contestTotal !== 'number';
    if (aBlank && bBlank) return entrantOrder.indexOf(a.entrant) - entrantOrder.indexOf(b.entrant);
    if (aBlank) return 1;
    if (bBlank) return -1;
    if (a.contestTotal !== b.contestTotal) return a.contestTotal - b.contestTotal;
    return entrantOrder.indexOf(a.entrant) - entrantOrder.indexOf(b.entrant);
  });

  standings.forEach(s => {
    if (typeof s.contestTotal !== 'number') {
      s.rank = null;
    } else {
      s.rank = 1 + standings.filter(
        other => typeof other.contestTotal === 'number' && other.contestTotal < s.contestTotal
      ).length;
    }
  });

  return standings;
}

function web_writeFinalsToSheet_(payload) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Contest');
  if (!sheet) return;

  const headerRow = 8;
  const firstDataRow = 9;
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const col = {};

  headers.forEach((header, i) => {
    if (header) col[String(header).trim()] = i + 1;
  });

  const rowCount = Math.min(15, Math.max(0, sheet.getLastRow() - firstDataRow + 1));
  const rows = rowCount
    ? sheet.getRange(firstDataRow, 1, rowCount, Math.max(col['Updated'] || 12, 12)).getDisplayValues()
    : [];

  payload.players.forEach(player => {
    const pick = web_findPick_(player.entrant, player.player);
    if (!pick) return;

    const target = rows.findIndex(row => {
      const entrant = String(row[(col['Entrant'] || 1) - 1] || '');
      const display = String(row[(col['Player'] || 2) - 1] || '');
      return entrant === player.entrant && web_namesMatch_(display, pick.player);
    });

    if (target < 0) return;
    const rowNumber = firstDataRow + target;

    if (col['R5']) {
      sheet.getRange(rowNumber, col['R5']).setValue(
        player.rounds && typeof player.rounds[4] === 'number' ? player.rounds[4] : ''
      );
    }
    if (col['Total'] && typeof player.total === 'number') {
      sheet.getRange(rowNumber, col['Total']).setValue(player.total);
    }
    if (col['Current Rd']) sheet.getRange(rowNumber, col['Current Rd']).setValue(5);
    if (col['Thru']) sheet.getRange(rowNumber, col['Thru']).setValue(player.thru || '-');
    if (col['Place']) sheet.getRange(rowNumber, col['Place']).setValue(player.place || '');
    if (col['Updated']) sheet.getRange(rowNumber, col['Updated']).setValue(new Date());
  });

  const standingsValues = payload.standings.map(s => [
    s.rank || '',
    s.entrant,
    typeof s.contestTotal === 'number' ? s.contestTotal : '',
    s.droppedPlayer || '',
    typeof s.droppedScore === 'number' ? s.droppedScore : ''
  ]);

  if (standingsValues.length) {
    sheet.getRange(3, 1, standingsValues.length, 5).setValues(standingsValues);
  }

  SpreadsheetApp.flush();
}

function web_findPick_(entrant, displayedName) {
  return WEB_PICKS_.find(p =>
    p.entrant === entrant && web_namesMatch_(displayedName, p.player)
  ) || null;
}

function web_namesMatch_(a, b) {
  const aa = web_normalizeName_(a);
  const bb = web_normalizeName_(b);

  if (aa === bb) return true;

  // Sheet displays names as "C. Heimburg", while pick config has "Calvin Heimburg".
  const ap = aa.split(' ');
  const bp = bb.split(' ');

  if (ap.length >= 2 && bp.length >= 2) {
    const aLast = ap[ap.length - 1];
    const bLast = bp[bp.length - 1];
    const aFirst = ap[0];
    const bFirst = bp[0];

    if (
      aLast === bLast &&
      aFirst.charAt(0) === bFirst.charAt(0)
    ) {
      return true;
    }
  }

  return false;
}

function web_normalizeName_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function web_getPdgaNumber_(player) {
  return web_getField_(player, [
    'PDGANum', 'pdgaNum', 'PDGANumber', 'pdgaNumber',
    'PDGA', 'pdga', 'PDGA#', 'PDGA_Number', 'pdga_number'
  ]);
}

function web_extractScoreArray_(root) {
  let rootValue = root;

  if (rootValue && typeof rootValue === 'object' && !Array.isArray(rootValue)) {
    const data = web_getField_(rootValue, ['data']);
    if (data !== undefined) rootValue = data;
  }

  if (rootValue && typeof rootValue === 'object' && !Array.isArray(rootValue)) {
    const direct = web_getField_(rootValue, ['scores', 'Scores']);
    if (Array.isArray(direct)) return direct;
  }

  const candidates = [];

  function walk(value, depth) {
    if (depth > 8 || value === null || value === undefined) return;

    if (Array.isArray(value)) {
      const objects = value.filter(v => v && typeof v === 'object' && !Array.isArray(v));

      if (objects.length) {
        let score = 0;

        objects.slice(0, 10).forEach(obj => {
          if (web_getField_(obj, ['Name', 'name', 'PlayerName', 'playerName'])) score += 5;
          if (web_getField_(obj, ['ToPar', 'toPar', 'topar']) !== undefined) score += 3;
          if (web_getField_(obj, ['RoundtoPar', 'RoundToPar', 'roundToPar']) !== undefined) score += 3;
          if (web_getField_(obj, ['Played', 'played']) !== undefined) score += 1;
        });

        candidates.push({ value: value, score: score + Math.min(objects.length, 200) / 100 });
      }

      value.slice(0, 20).forEach(v => walk(v, depth + 1));
      return;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(key => walk(value[key], depth + 1));
    }
  }

  walk(rootValue, 0);
  candidates.sort((a, b) => b.score - a.score);

  return candidates.length && candidates[0].score >= 5
    ? candidates[0].value
    : [];
}

function web_getField_(obj, names) {
  if (!obj || typeof obj !== 'object') return undefined;

  for (let i = 0; i < names.length; i++) {
    if (Object.prototype.hasOwnProperty.call(obj, names[i])) return obj[names[i]];
  }

  const keyMap = {};
  Object.keys(obj).forEach(key => {
    keyMap[String(key).toLowerCase()] = key;
  });

  for (let i = 0; i < names.length; i++) {
    const actual = keyMap[String(names[i]).toLowerCase()];
    if (actual !== undefined) return obj[actual];
  }

  return undefined;
}

function web_numericOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function web_scoreNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim().toUpperCase() === 'E') return 0;

  const cleaned = typeof value === 'string'
    ? value.replace(/^\+/, '').trim()
    : value;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function web_number_(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function web_bool_(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (typeof value === 'string') {
    return ['true', 'yes', 'y'].indexOf(value.toLowerCase()) >= 0;
  }
  return false;
}

function web_valueOrNull_(value) {
  return value === '' || value === null || value === undefined ? null : value;
}

function web_dateIsoOrNull_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
