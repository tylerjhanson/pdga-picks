/**
 * PDGA Picks standalone web endpoint — direct PDGA feed.
 *
 * This endpoint does NOT depend on the Contest sheet for live scores.
 * It fetches PDGA rounds 1-4 plus Finals (API Round 12) directly,
 * calculates the contest, and returns JSONP to GitHub Pages.
 *
 * Deploy as Web app:
 *   Execute as: Me
 *   Who has access: Anyone
 */

const WEB8_EVENT_ID = '97344';
const WEB8_DIVISION = 'MPO';

const WEB8_PICKS = [
  { entrant: 'Ben', player: 'Ricky Wysocki', pdga: '38008', aliases: ['Richard Wysocki', 'Ricky Wysocki'] },
  { entrant: 'Ben', player: 'Isaac Robinson', pdga: '50670', aliases: ['Isaac Robinson'] },
  { entrant: 'Ben', player: 'Evan Smith', pdga: '101574', aliases: ['Evan Smith'] },
  { entrant: 'Ben', player: 'Luke Taylor', pdga: '102119', aliases: ['Luke Taylor'] },
  { entrant: 'Ben', player: 'Kyle Klein', pdga: '85132', aliases: ['Kyle Klein'] },

  { entrant: 'Nathan', player: 'Niklas Anttila', pdga: '91249', aliases: ['Niklas Anttila', 'Niklas Antilla'] },
  { entrant: 'Nathan', player: 'Gannon Buhr', pdga: '75412', aliases: ['Gannon Buhr'] },
  { entrant: 'Nathan', player: 'Ezra Robinson', pdga: '50671', aliases: ['Ezra Robinson'] },
  { entrant: 'Nathan', player: 'Sullivan Tipton', pdga: '78817', aliases: ['Sullivan Tipton'] },
  { entrant: 'Nathan', player: 'Cole Redalen', pdga: '79748', aliases: ['Cole Redalen'] },

  { entrant: 'Tyler', player: 'Calvin Heimburg', pdga: '45971', aliases: ['Calvin Heimburg'] },
  { entrant: 'Tyler', player: 'Eagle McMahon', pdga: '37817', aliases: ['Eagle McMahon'] },
  { entrant: 'Tyler', player: 'Simon Lizotte', pdga: '8332', aliases: ['Simon Lizotte'] },
  { entrant: 'Tyler', player: 'Adam Hammes', pdga: '57365', aliases: ['Adam Hammes'] },
  { entrant: 'Tyler', player: 'Anthony Barela', pdga: '44382', aliases: ['Anthony Barela'] }
];

function doGet(e) {
  const requested = e && e.parameter ? String(e.parameter.callback || '') : '';
  const callback = /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(requested)
    ? requested
    : '__pdgaPicksReceive';

  let payload;

  try {
    payload = web8_getPayload_();
  } catch (error) {
    payload = {
      ok: false,
      bridgeVersion: 'direct-v16',
      error: error && error.message ? error.message : String(error)
    };
  }

  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function web8_getPayload_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pdga_picks_direct_v16';
  const cached = cache.get(cacheKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(2500)) {
    const retryCache = cache.get(cacheKey);
    if (retryCache) return JSON.parse(retryCache);
  }

  try {
    const roundScores = {};
    const roundRaw = {};
    const diagnostics = [];

    // R1-R4 map normally.
    for (let contestRound = 1; contestRound <= 4; contestRound++) {
      const fetched = web8_fetchRound_(contestRound);
      const scores = web8_extractScores_(fetched.json);

      roundScores[contestRound] = scores;
      roundRaw[contestRound] = fetched.json;

      diagnostics.push({
        contestRound: contestRound,
        apiRound: contestRound,
        http: fetched.code,
        players: scores.length,
        realScoring: web8_roundHasRealScoring_(scores),
        identityRows: web8_identityRowCount_(scores)
      });
    }

    // Finals are PDGA API Round 12 for this event.
    const fetched12 = web8_fetchRound_(12);
    const scores12 = web8_extractScores_(fetched12.json);

    // Optional live-delta endpoint. It can expose identity even when the
    // full Finals leaderboard rows do not.
    const updated12 = web8_fetchUpdatedRoundScoresSafe_(12);
    const updatedScores12 = updated12.ok
      ? web8_extractScores_(updated12.json)
      : [];

    roundScores[5] = scores12;
    roundRaw[5] = fetched12.json;

    diagnostics.push({
      contestRound: 5,
      apiRound: 12,
      http: fetched12.code,
      players: scores12.length,
      realScoring: web8_roundHasRealScoring_(scores12),
      identityRows: web8_identityRowCount_(scores12),
      updatedHttp: updated12.code,
      updatedPlayers: updatedScores12.length,
      updatedIdentityRows: web8_identityRowCount_(updatedScores12),
      updatedRealScoring: web8_roundHasRealScoring_(updatedScores12)
    });
    let currentRound = 1;

    for (let round = 1; round <= 5; round++) {
      if (web8_roundHasRealScoring_(roundScores[round])) {
        currentRound = round;
      }
    }

    const draftOrder = {};
    WEB8_PICKS.forEach((pick, i) => {
      draftOrder[pick.entrant + '|' + pick.player] = i;
    });

    const finalsAssignments = currentRound === 5
      ? web8_buildFinalsAssignmentsV16_(
          roundScores[5],
          updatedScores12,
          roundScores[4],
          WEB8_PICKS
        )
      : {};

    const players = WEB8_PICKS.map((pick, order) => {
      const rounds = [null, null, null, null, null];
      let latestFound = null;
      let foundInCurrentRound = false;
      let roundSum = 0;
      let hasRoundScore = false;

      for (let round = 1; round <= currentRound; round++) {
        let found = round === 5
          ? (finalsAssignments[pick.pdga]
              ? finalsAssignments[pick.pdga].player
              : null)
          : web8_findPlayer_(roundScores[round], pick);

        if (!found) continue;

        latestFound = found;
        if (round === currentRound) foundInCurrentRound = true;

        const played = web8_number_(web8_getField_(found, [
          'Played', 'played', 'HolesPlayed', 'holesPlayed'
        ]), 0);

        const completed = web8_bool_(web8_getField_(found, [
          'Completed', 'completed', 'IsComplete', 'isComplete'
        ]));

        const roundToPar = web8_scoreNumber_(web8_getField_(found, [
          'RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar',
          'RdToPar', 'rdToPar'
        ]));

        const verifiedPlayerFinals =
          round === 5 &&
          web8_bool_(web8_getField_(found, [
            'WEB8LiveFinals', 'web8LiveFinals'
          ]));

        if (
          roundToPar !== null &&
          (
            round < currentRound ||
            played > 0 ||
            completed ||
            verifiedPlayerFinals
          )
        ) {
          rounds[round - 1] = roundToPar;
          roundSum += roundToPar;
          hasRoundScore = true;
        }
      }

      let total = null;
      let thru = '-';
      let place = '';

      if (latestFound) {
        const cumulative = web8_scoreNumber_(web8_getField_(latestFound, [
          'ToPar', 'toPar', 'topar', 'TotalToPar', 'totalToPar', 'Total'
        ]));

        const allFiveRoundsKnown =
          currentRound === 5 &&
          rounds.slice(0, 5).every(value =>
            typeof value === 'number' && Number.isFinite(value)
          );

        // During Finals PDGA's cumulative ToPar can reflect a later live state
        // even on earlier-round endpoints. For a finalist, the authoritative
        // contest total is the sum of the five actual RoundtoPar values.
        total = allFiveRoundsKnown
          ? rounds.slice(0, 5).reduce((sum, value) => sum + value, 0)
          : (cumulative !== null
              ? cumulative
              : (hasRoundScore ? roundSum : null));

        const played = web8_number_(web8_getField_(latestFound, [
          'Played', 'played', 'HolesPlayed', 'holesPlayed'
        ]), 0);

        const holes = web8_number_(web8_getField_(latestFound, [
          'Holes', 'holes', 'TotalHoles', 'totalHoles'
        ]), 18);

        const completed = web8_bool_(web8_getField_(latestFound, [
          'Completed', 'completed', 'IsComplete', 'isComplete'
        ]));

        thru = completed || played >= holes
          ? 'F'
          : (played > 0 ? String(played) : '-');

        // If Finals are underway and the player is not in the Finals feed,
        // they did not advance.
        if (currentRound === 5 && !foundInCurrentRound) {
          thru = 'CUT';
        }

        const runningPlace = web8_getField_(latestFound, [
          'RunningPlace', 'runningPlace', 'Place', 'place',
          'Position', 'position'
        ]);

        if (
          runningPlace !== null &&
          runningPlace !== undefined &&
          runningPlace !== ''
        ) {
          const tied = web8_bool_(web8_getField_(latestFound, [
            'Tied', 'tied', 'IsTied', 'isTied'
          ]));

          place = (tied ? 'T' : '') + runningPlace;
        }
      }

      return {
        entrant: pick.entrant,
        player: pick.player,
        rounds: rounds,
        total: total,
        currentRound: currentRound,
        thru: thru,
        place: place,
        updated: new Date().toISOString(),
        drop: false,
        _order: order
      };
    });

    const entrantOrder = ['Ben', 'Nathan', 'Tyler'];

    players.sort((a, b) => {
      const entrantDiff =
        entrantOrder.indexOf(a.entrant) - entrantOrder.indexOf(b.entrant);

      if (entrantDiff !== 0) return entrantDiff;

      const aBlank = typeof a.total !== 'number' || !Number.isFinite(a.total);
      const bBlank = typeof b.total !== 'number' || !Number.isFinite(b.total);

      if (aBlank && bBlank) return a._order - b._order;
      if (aBlank) return 1;
      if (bBlank) return -1;

      if (a.total !== b.total) return a.total - b.total;
      return a._order - b._order;
    });

    const standings = entrantOrder.map(entrant => {
      const group = players.filter(p => p.entrant === entrant);
      const scored = group.filter(
        p => typeof p.total === 'number' && Number.isFinite(p.total)
      );

      if (scored.length < 5) {
        return {
          rank: null,
          entrant: entrant,
          contestTotal: null,
          droppedPlayer: '',
          droppedScore: null
        };
      }

      // Group is already displayed best-to-worst. Last player is dropped.
      // This also means a tied worst score drops the visually last tied player.
      const dropped = scored[scored.length - 1];
      dropped.drop = true;

      const contestTotal = scored
        .slice(0, 4)
        .reduce((sum, player) => sum + player.total, 0);

      return {
        rank: null,
        entrant: entrant,
        contestTotal: contestTotal,
        droppedPlayer: dropped.player,
        droppedScore: dropped.total
      };
    });

    standings.sort((a, b) => {
      const aBlank =
        typeof a.contestTotal !== 'number' ||
        !Number.isFinite(a.contestTotal);

      const bBlank =
        typeof b.contestTotal !== 'number' ||
        !Number.isFinite(b.contestTotal);

      if (aBlank && bBlank) {
        return entrantOrder.indexOf(a.entrant) - entrantOrder.indexOf(b.entrant);
      }

      if (aBlank) return 1;
      if (bBlank) return -1;

      if (a.contestTotal !== b.contestTotal) {
        return a.contestTotal - b.contestTotal;
      }

      return entrantOrder.indexOf(a.entrant) - entrantOrder.indexOf(b.entrant);
    });

    standings.forEach(row => {
      if (
        typeof row.contestTotal !== 'number' ||
        !Number.isFinite(row.contestTotal)
      ) {
        row.rank = null;
      } else {
        row.rank = 1 + standings.filter(other =>
          typeof other.contestTotal === 'number' &&
          Number.isFinite(other.contestTotal) &&
          other.contestTotal < row.contestTotal
        ).length;
      }
    });

    const payload = {
      ok: true,
      bridgeVersion: 'direct-v16',
      eventId: WEB8_EVENT_ID,
      division: WEB8_DIVISION,
      currentRound: currentRound,
      updatedAt: new Date().toISOString(),
      standings: standings,
      players: players.map(p => ({
        entrant: p.entrant,
        player: p.player,
        rounds: p.rounds,
        total: p.total,
        currentRound: p.currentRound,
        thru: p.thru,
        place: p.place,
        updated: p.updated,
        drop: p.drop
      })),
      feedDiagnostics: diagnostics,
      matchDiagnostics: (() => {
        const kyleAssignment = finalsAssignments['85132'] || null;
        const finalsDiag = diagnostics.find(d => d.contestRound === 5) || {};
        const dbg = finalsAssignments._debug || {};
        const kyleDbg = dbg.kyle || {};

        return {
          kyleFinalsMatched: !!kyleAssignment,
          kyleMethod: kyleAssignment ? kyleAssignment.method : '',
          kyleFinalsIndex: kyleAssignment ? kyleAssignment.index : null,
          assignedFinalists: Object.keys(finalsAssignments).length,
          api12Players: finalsDiag.players || 0,
          api12IdentityRows: finalsDiag.identityRows || 0,
          updatedHttp: finalsDiag.updatedHttp || 0,
          updatedPlayers: finalsDiag.updatedPlayers || 0,
          updatedIdentityRows: finalsDiag.updatedIdentityRows || 0,
          kyleResultId: kyleDbg.resultId || '',
          kylePlayerHttp: kyleDbg.playerHttp || 0,
          kylePlayerCandidates: kyleDbg.playerCandidates || 0,
          kyleSelectedRound:
            kyleDbg.selectedRound === null || kyleDbg.selectedRound === undefined
              ? ''
              : kyleDbg.selectedRound,
          kyleSelectedResultId: kyleDbg.selectedResultId || '',
          kyleSelectedScoreId: kyleDbg.selectedScoreId || '',
          kyleDeepScoreIdMatches: kyleDbg.deepScoreIdMatches || 0,
          kyleFullRowMatched: !!kyleDbg.fullRowMatched,
          kyleFullRowMethod: kyleDbg.fullRowMethod || '',
          kyleFullRowIndex:
            kyleDbg.fullRowIndex === null || kyleDbg.fullRowIndex === undefined
              ? -1
              : kyleDbg.fullRowIndex,
          kyleFullRowPlayed:
            kyleDbg.fullRowPlayed === null || kyleDbg.fullRowPlayed === undefined
              ? ''
              : kyleDbg.fullRowPlayed,
          kyleFullRowRoundToPar:
            kyleDbg.fullRowRoundToPar === null || kyleDbg.fullRowRoundToPar === undefined
              ? ''
              : kyleDbg.fullRowRoundToPar,
          kyleFullRowToPar:
            kyleDbg.fullRowToPar === null || kyleDbg.fullRowToPar === undefined
              ? ''
              : kyleDbg.fullRowToPar,
          kyleLiveSummary: kyleDbg.liveSummary || {},
          kyleResponseProgress: kyleDbg.responseProgress || {}
        };
      })()
    };

    try {
      cache.put(cacheKey, JSON.stringify(payload), 15);
    } catch (e) {}

    return payload;
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function web8_fetchRound_(apiRound) {
  const url =
    'https://www.pdga.com/apps/tournament/live-api/live_results_fetch_round' +
    '?TournID=' + encodeURIComponent(WEB8_EVENT_ID) +
    '&Division=' + encodeURIComponent(WEB8_DIVISION) +
    '&Round=' + encodeURIComponent(apiRound);

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 Chrome/151 Safari/537.36',
      'Referer':
        'https://www.pdga.com/live/event/' +
        WEB8_EVENT_ID + '/' + WEB8_DIVISION +
        '/scores?round=' + apiRound,
      'Cache-Control': 'no-cache'
    }
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('PDGA API Round ' + apiRound + ' returned HTTP ' + code);
  }

  let json;

  try {
    json = JSON.parse(text);
    json = web8_unwrapJsonStrings_(json);
  } catch (e) {
    throw new Error('PDGA API Round ' + apiRound + ' returned invalid JSON');
  }

  return {
    code: code,
    json: json
  };
}

function web8_fetchUpdatedRoundScoresSafe_(apiRound) {
  try {
    const since = Utilities.formatDate(
      new Date(Date.now() - 48 * 60 * 60 * 1000),
      'America/New_York',
      'yyyy-MM-dd HH:mm:ss'
    );

    const url =
      'https://www.pdga.com/apps/tournament/live-api/live_results_fetch_updated_round_scores' +
      '?TournID=' + encodeURIComponent(WEB8_EVENT_ID) +
      '&Division=' + encodeURIComponent(WEB8_DIVISION) +
      '&Round=' + encodeURIComponent(apiRound) +
      '&UpdatedAfter=' + encodeURIComponent(since);

    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 Chrome/151 Safari/537.36',
        'Referer':
          'https://www.pdga.com/live/event/' +
          WEB8_EVENT_ID + '/' + WEB8_DIVISION +
          '/scores?round=' + apiRound,
        'Cache-Control': 'no-cache'
      }
    });

    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      return { ok: false, code: code, json: null };
    }

    let json;
    try {
      json = JSON.parse(response.getContentText());
      json = web8_unwrapJsonStrings_(json);
    } catch (e) {
      return { ok: false, code: code, json: null };
    }

    return { ok: true, code: code, json: json };
  } catch (e) {
    return { ok: false, code: 0, json: null };
  }
}

function web8_fetchPlayerLiveBatch_(round4Scores, picks) {
  const jobs = [];
  const output = {};

  (picks || []).forEach(pick => {
    const r4 = web8_findPlayer_(round4Scores || [], pick);
    const resultId = r4
      ? web8_getField_(r4, ['ResultID', 'resultId', 'resultID', 'result_id'])
      : null;

    output[pick.pdga] = {
      resultId: resultId == null ? '' : String(resultId),
      http: 0,
      candidateCount: 0,
      record: null,
      progress: {
        played: 0,
        completed: false,
        place: ''
      }
    };

    if (resultId === null || resultId === undefined || String(resultId) === '') {
      return;
    }

    jobs.push({
      pick: pick,
      resultId: String(resultId),
      request: {
        url:
          'https://www.pdga.com/apps/tournament/live-api/live_results_fetch_player' +
          '?ResultID=' + encodeURIComponent(resultId),
        method: 'get',
        followRedirects: true,
        muteHttpExceptions: true,
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 Chrome/151 Safari/537.36',
          'Referer':
            'https://www.pdga.com/live/event/' +
            WEB8_EVENT_ID + '/' + WEB8_DIVISION +
            '/scores?round=12',
          'Cache-Control': 'no-cache'
        }
      }
    });
  });

  if (!jobs.length) return output;

  let responses = [];
  try {
    responses = UrlFetchApp.fetchAll(jobs.map(job => job.request));
  } catch (e) {
    return output;
  }

  jobs.forEach((job, i) => {
    const response = responses[i];
    if (!response) return;

    const code = response.getResponseCode();
    output[job.pick.pdga].http = code;

    if (code < 200 || code >= 300) return;

    let json;
    try {
      json = JSON.parse(response.getContentText());
      json = web8_unwrapJsonStrings_(json);
    } catch (e) {
      return;
    }

    const extracted = web8_extractBestPlayerLiveRecord_(json, job.resultId);
    output[job.pick.pdga].candidateCount = extracted.candidateCount;
    output[job.pick.pdga].record = extracted.record;

    const selectedScoreId = extracted.record
      ? web8_getField_(extracted.record, [
          'ScoreID', 'scoreId', 'scoreID', 'score_id'
        ])
      : null;

    output[job.pick.pdga].progress =
      web8_extractPlayerLiveProgress_(json, selectedScoreId);
  });

  return output;
}

function web8_extractPlayerLiveProgress_(root, selectedScoreId) {
  let bestPlayed = 0;
  let completed = false;
  let place = '';
  let bestPlaceQuality = -1;

  function scoreArrayCount(value) {
    if (!Array.isArray(value)) return 0;

    return value.filter(item => {
      if (item === null || item === undefined || item === '') return false;

      if (typeof item === 'number') return item > 0;

      if (typeof item === 'string') {
        const s = item.trim();
        return s !== '' && s !== '0' && s !== '-' && s !== '·';
      }

      if (typeof item === 'object') {
        const score = web8_getField_(item, [
          'Score', 'score', 'Strokes', 'strokes',
          'Result', 'result', 'ScoreValue', 'scoreValue'
        ]);

        return (
          score !== undefined &&
          score !== null &&
          String(score).trim() !== ''
        );
      }

      return false;
    }).length;
  }

  function walk(node, depth, finalContext) {
    if (
      depth > 10 ||
      node === null ||
      node === undefined
    ) {
      return;
    }

    if (Array.isArray(node)) {
      node.slice(0, 500).forEach(item =>
        walk(item, depth + 1, finalContext)
      );
      return;
    }

    if (typeof node !== 'object') return;

    const round = web8_number_(web8_getField_(node, [
      'Round', 'round', 'RoundNumber', 'roundNumber'
    ]), 0);

    const scoreId = web8_getField_(node, [
      'ScoreID', 'scoreId', 'scoreID', 'score_id'
    ]);

    const scoreIdMatch =
      selectedScoreId !== null &&
      selectedScoreId !== undefined &&
      String(selectedScoreId) !== '' &&
      scoreId !== null &&
      scoreId !== undefined &&
      String(scoreId) === String(selectedScoreId);

    const isFinalContext =
      finalContext ||
      round === 12 ||
      round === 5 ||
      scoreIdMatch;

    if (isFinalContext) {
      const directPlayed = web8_number_(web8_getField_(node, [
        'Played', 'played', 'HolesPlayed', 'holesPlayed'
      ]), 0);

      if (directPlayed > bestPlayed) bestPlayed = directPlayed;

      const holeCandidates = [
        web8_getField_(node, ['HoleScores', 'holeScores']),
        web8_getField_(node, ['Scores', 'scores']),
        web8_getField_(node, ['SortScores', 'sortScores'])
      ];

      holeCandidates.forEach(value => {
        const count = scoreArrayCount(value);
        if (count > bestPlayed && count <= 18) bestPlayed = count;
      });

      if (web8_bool_(web8_getField_(node, [
        'Completed', 'completed', 'IsComplete', 'isComplete'
      ]))) {
        completed = true;
      }

      const roundStatus = web8_getField_(node, [
        'RoundStatus', 'roundStatus',
        'PlayerThrowStatus', 'playerThrowStatus',
        'Status', 'status'
      ]);

      if (
        roundStatus !== null &&
        roundStatus !== undefined
      ) {
        const statusText = String(roundStatus).trim().toLowerCase();

        if (
          statusText.indexOf('complete') !== -1 ||
          statusText.indexOf('finish') !== -1 ||
          statusText === 'final' ||
          statusText === 'f'
        ) {
          completed = true;
        }
      }

      const runningPlace = web8_getField_(node, [
        'RunningPlace', 'runningPlace', 'Place', 'place',
        'Position', 'position'
      ]);

      if (
        runningPlace !== null &&
        runningPlace !== undefined &&
        String(runningPlace) !== ''
      ) {
        let quality = 1;
        if (round === 12) quality += 3;
        if (scoreIdMatch) quality += 4;
        if (directPlayed > 0) quality += 2;

        if (quality > bestPlaceQuality) {
          place = runningPlace;
          bestPlaceQuality = quality;
        }
      }
    }

    Object.keys(node).forEach(key => {
      const child = node[key];
      if (child && typeof child === 'object') {
        walk(child, depth + 1, isFinalContext);
      }
    });
  }

  walk(root, 0, false);

  return {
    played: bestPlayed,
    completed: completed,
    place: place
  };
}

function web8_extractBestPlayerLiveRecord_(root, requestedResultId) {
  const candidates = [];

  function walk(value, depth) {
    if (depth > 8 || value === null || value === undefined) return;

    if (Array.isArray(value)) {
      value.slice(0, 300).forEach(item => walk(item, depth + 1));
      return;
    }

    if (typeof value !== 'object') return;

    const keys = Object.keys(value);
    const roundToPar = web8_scoreNumber_(web8_getField_(value, [
      'RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar'
    ]));
    const toPar = web8_scoreNumber_(web8_getField_(value, [
      'ToPar', 'toPar', 'topar', 'TotalToPar', 'totalToPar'
    ]));
    const played = web8_number_(web8_getField_(value, [
      'Played', 'played', 'HolesPlayed', 'holesPlayed'
    ]), 0);
    const runningPlace = web8_getField_(value, [
      'RunningPlace', 'runningPlace', 'Place', 'place'
    ]);
    const round = web8_number_(web8_getField_(value, [
      'Round', 'round', 'RoundNumber', 'roundNumber'
    ]), 0);
    const resultId = web8_getField_(value, [
      'ResultID', 'resultId', 'resultID', 'result_id'
    ]);

    const scoreLike =
      roundToPar !== null ||
      toPar !== null ||
      played > 0 ||
      runningPlace !== undefined;

    if (scoreLike) {
      let quality = 0;

      if (round === 12) quality += 50;
      else if (round > 4) quality += 30;
      else if (round > 0) quality += round;

      if (played > 0) quality += 12;
      if (roundToPar !== null) quality += 10;
      if (toPar !== null) quality += 10;
      if (runningPlace !== undefined && runningPlace !== null && runningPlace !== '') quality += 6;

      if (
        requestedResultId &&
        resultId !== undefined &&
        resultId !== null &&
        String(resultId) === String(requestedResultId)
      ) {
        quality += 8;
      }

      quality += Math.min(keys.length, 80) / 100;

      candidates.push({
        record: value,
        quality: quality,
        round: round,
        played: played
      });
    }

    keys.forEach(key => {
      const child = value[key];
      if (child && typeof child === 'object') walk(child, depth + 1);
    });
  }

  walk(root, 0);

  candidates.sort((a, b) => {
    if (b.quality !== a.quality) return b.quality - a.quality;
    if (b.round !== a.round) return b.round - a.round;
    return b.played - a.played;
  });

  return {
    record: candidates.length ? candidates[0].record : null,
    candidateCount: candidates.length
  };
}


function web8_extractScores_(root) {
  if (!root) return [];

  let data = root;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const wrapped = web8_getField_(data, ['data']);
    if (wrapped !== undefined) data = wrapped;
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const direct = web8_getField_(data, ['scores', 'Scores']);
    if (Array.isArray(direct)) return direct;
  }

  const candidates = [];

  function walk(value, depth) {
    if (depth > 8 || value === null || value === undefined) return;

    if (Array.isArray(value)) {
      const objects = value.filter(item =>
        item && typeof item === 'object' && !Array.isArray(item)
      );

      if (objects.length) {
        let quality = 0;

        objects.slice(0, 10).forEach(obj => {
          if (web8_getPlayerName_(obj)) quality += 5;

          if (web8_getField_(obj, [
            'ToPar', 'toPar', 'topar', 'TotalToPar', 'totalToPar'
          ]) !== undefined) quality += 3;

          if (web8_getField_(obj, [
            'RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar'
          ]) !== undefined) quality += 3;

          if (web8_getField_(obj, [
            'Played', 'played', 'HolesPlayed', 'holesPlayed'
          ]) !== undefined) quality += 1;

          if (web8_getField_(obj, [
            'RunningPlace', 'runningPlace', 'Place', 'place'
          ]) !== undefined) quality += 1;
        });

        quality += Math.min(objects.length, 200) / 100;
        candidates.push({ array: value, quality: quality });
      }

      value.slice(0, 20).forEach(item => walk(item, depth + 1));
      return;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(key => walk(value[key], depth + 1));
    }
  }

  walk(root, 0);

  candidates.sort((a, b) => b.quality - a.quality);

  if (!candidates.length || candidates[0].quality < 5) return [];
  return candidates[0].array;
}

function web8_roundHasRealScoring_(scores) {
  return (scores || []).some(player => {
    const played = web8_number_(web8_getField_(player, [
      'Played', 'played', 'HolesPlayed', 'holesPlayed'
    ]), 0);

    const completed = web8_bool_(web8_getField_(player, [
      'Completed', 'completed', 'IsComplete', 'isComplete'
    ]));

    const roundToPar = web8_scoreNumber_(web8_getField_(player, [
      'RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar',
      'RdToPar', 'rdToPar'
    ]));

    return (
      played > 0 ||
      completed ||
      (roundToPar !== null && roundToPar !== 0)
    );
  });
}

function web8_findPlayer_(scores, pick) {
  const aliases = [pick.player]
    .concat(pick.aliases || [])
    .filter(Boolean);

  return (scores || []).find(player => {
    // First try the normal top-level fields used in R1-R4.
    const pdgaNumber = web8_getPdgaNumber_(player);

    if (
      pick.pdga &&
      pdgaNumber &&
      String(pdgaNumber) === String(pick.pdga)
    ) {
      return true;
    }

    const candidateNames = [
      web8_getPlayerName_(player),
      web8_getField_(player, ['ShortName', 'shortName', 'short_name']),
      web8_getField_(player, ['PlayerName', 'playerName', 'player_name']),
      [
        web8_getField_(player, ['FirstName', 'firstName', 'first_name']),
        web8_getField_(player, ['LastName', 'lastName', 'last_name'])
      ].filter(Boolean).join(' '),
      [
        web8_getField_(player, ['LastName', 'lastName', 'last_name']),
        web8_getField_(player, ['FirstName', 'firstName', 'first_name'])
      ].filter(Boolean).join(' ')
    ].filter(Boolean);

    if (
      candidateNames.some(candidate =>
        aliases.some(alias => web8_namesEquivalent_(candidate, alias))
      )
    ) {
      return true;
    }

    // Finals records can nest player identity inside another object.
    // Search all scalar values recursively for the PDGA number or full name.
    const scalarValues = [];
    web8_collectScalarValues_(player, scalarValues, 0);

    if (pick.pdga) {
      const wantedPdga = String(pick.pdga).replace(/\D/g, '');

      if (
        scalarValues.some(value => {
          const digits = String(value == null ? '' : value).replace(/\D/g, '');
          return digits === wantedPdga;
        })
      ) {
        return true;
      }
    }

    return scalarValues.some(value =>
      aliases.some(alias => web8_namesEquivalent_(value, alias))
    );
  }) || null;
}

function web8_collectScalarValues_(value, out, depth) {
  if (depth > 5 || value === null || value === undefined) return;

  if (
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    out.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.slice(0, 100).forEach(item =>
      web8_collectScalarValues_(item, out, depth + 1)
    );
    return;
  }

  if (typeof value === 'object') {
    Object.keys(value).forEach(key =>
      web8_collectScalarValues_(value[key], out, depth + 1)
    );
  }
}

function web8_identityRowCount_(scores) {
  return (scores || []).filter(row => {
    const name = web8_getPlayerName_(row);
    const pdga = web8_getPdgaNumber_(row);
    return !!(String(name || '').trim() || String(pdga || '').trim());
  }).length;
}

function web8_buildFinalsAssignmentsV16_(round12Scores, updatedScores, round4Scores, picks) {
  const assignments = {};
  const playerBatch = web8_fetchPlayerLiveBatch_(round4Scores, picks);

  function assign(pick, record, method, index) {
    if (!pick || !record || assignments[pick.pdga]) return false;

    assignments[pick.pdga] = {
      player: record,
      method: method,
      index: index == null ? -1 : index
    };

    return true;
  }

  // 1) Full Round 12 feed if identity happens to match normally.
  (picks || []).forEach(pick => {
    const found = web8_findPlayer_(round12Scores || [], pick);
    if (found) {
      assign(
        pick,
        found,
        'round12-direct',
        (round12Scores || []).indexOf(found)
      );
    }
  });

  // 2) Updated-round feed if it exposes identity.
  (picks || []).forEach(pick => {
    if (assignments[pick.pdga]) return;

    const found = web8_findPlayer_(updatedScores || [], pick);
    if (found) {
      assign(
        pick,
        found,
        'updated-round-direct',
        (updatedScores || []).indexOf(found)
      );
    }
  });

  // 3) Player-specific endpoint gives us the correct Round-12 record for each
  // picked player. Use its current Round-12 IDs to locate the matching row in
  // the full Round-12 leaderboard, which has authoritative Played/ToPar/Place.
  (picks || []).forEach(pick => {
    if (assignments[pick.pdga]) return;

    const info = playerBatch[pick.pdga];
    if (!info || !info.record) return;

    const playerRecord = info.record;
    const fullMatch = web8_matchPlayerRecordToRound12_(
      playerRecord,
      round12Scores || []
    );

    if (fullMatch && fullMatch.record) {
      assign(
        pick,
        fullMatch.record,
        'player-endpoint-to-round12:' + fullMatch.method,
        fullMatch.index
      );
      return;
    }

    // Safe fallback: use the player endpoint record itself. It has the correct
    // live Finals round score even when the full anonymous leaderboard cannot
    // be joined back to it.
    const fallback = Object.assign({}, playerRecord);
    fallback.Name = pick.player;
    fallback.PDGANum = pick.pdga;

    const r4 = web8_findPlayer_(round4Scores || [], pick);
    if (r4) {
      ['Rating', 'Country', 'StateProv', 'City', 'ProfileURL', 'ShortName']
        .forEach(key => {
          const value = web8_getField_(r4, [key]);
          if (
            (fallback[key] === undefined || fallback[key] === null || fallback[key] === '') &&
            value !== undefined &&
            value !== null &&
            value !== ''
          ) {
            fallback[key] = value;
          }
        });

    }

    const infoProgress = info.progress || {};
    const derivedPlayed = Math.max(
      web8_derivePlayedFromScores_(fallback),
      web8_number_(infoProgress.played, 0)
    );

    if (derivedPlayed > 0) {
      fallback.Played = derivedPlayed;
    }

    if (infoProgress.completed) {
      fallback.Completed = true;
    }

    if (
      (fallback.RunningPlace === undefined ||
       fallback.RunningPlace === null ||
       fallback.RunningPlace === '') &&
      infoProgress.place !== undefined &&
      infoProgress.place !== null &&
      String(infoProgress.place) !== ''
    ) {
      fallback.RunningPlace = infoProgress.place;
    }

    // This is a verified player-specific Round-12 score record.
    // Its RoundtoPar is valid even when PDGA leaves Played=0.
    fallback.WEB8LiveFinals = true;

    assign(pick, fallback, 'player-resultid-live', -1);
  });

  const kyleInfo = playerBatch['85132'] || {};
  const kyleRecord = kyleInfo.record || null;
  const kyleProgress = kyleInfo.progress || {};
  const kyleFull = kyleRecord
    ? web8_matchPlayerRecordToRound12_(kyleRecord, round12Scores || [])
    : null;

  const kyleSelectedScoreId = kyleRecord
    ? web8_getField_(kyleRecord, [
        'ScoreID', 'scoreId', 'scoreID', 'score_id'
      ])
    : null;

  let kyleDeepScoreIdMatches = 0;

  if (
    kyleSelectedScoreId !== null &&
    kyleSelectedScoreId !== undefined &&
    String(kyleSelectedScoreId) !== ''
  ) {
    (round12Scores || []).forEach(row => {
      if (
        web8_objectContainsExactFieldValue_(
          row,
          ['ScoreID', 'scoreId', 'scoreID', 'score_id'],
          kyleSelectedScoreId,
          8
        )
      ) {
        kyleDeepScoreIdMatches++;
      }
    });
  }

  Object.defineProperty(assignments, '_debug', {
    value: {
      kyle: {
        resultId: kyleInfo.resultId || '',
        playerHttp: kyleInfo.http || 0,
        playerCandidates: kyleInfo.candidateCount || 0,
        selectedRound: kyleRecord
          ? web8_number_(web8_getField_(kyleRecord, [
              'Round', 'round', 'RoundNumber', 'roundNumber'
            ]), 0)
          : null,
        selectedResultId: kyleRecord
          ? String(web8_getField_(kyleRecord, [
              'ResultID', 'resultId', 'resultID', 'result_id'
            ]) || '')
          : '',
        selectedScoreId:
          kyleSelectedScoreId == null ? '' : String(kyleSelectedScoreId),
        deepScoreIdMatches: kyleDeepScoreIdMatches,
        fullRowMatched: !!(kyleFull && kyleFull.record),
        fullRowMethod: kyleFull ? kyleFull.method : '',
        fullRowIndex: kyleFull ? kyleFull.index : -1,
        fullRowPlayed: kyleFull && kyleFull.record
          ? web8_number_(web8_getField_(kyleFull.record, [
              'Played', 'played', 'HolesPlayed', 'holesPlayed'
            ]), 0)
          : null,
        fullRowRoundToPar: kyleFull && kyleFull.record
          ? web8_scoreNumber_(web8_getField_(kyleFull.record, [
              'RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar'
            ]))
          : null,
        fullRowToPar: kyleFull && kyleFull.record
          ? web8_scoreNumber_(web8_getField_(kyleFull.record, [
              'ToPar', 'toPar', 'topar', 'TotalToPar', 'totalToPar'
            ]))
          : null,
        liveSummary: web8_liveRecordSummary_(kyleRecord),
        responseProgress: {
          played: web8_number_(kyleProgress.played, 0),
          completed: !!kyleProgress.completed,
          place:
            kyleProgress.place === null ||
            kyleProgress.place === undefined
              ? ''
              : String(kyleProgress.place)
        }
      }
    },
    enumerable: false
  });

  return assignments;
}

function web8_derivePlayedFromScores_(record) {
  if (!record || typeof record !== 'object') return 0;

  const directPlayed = web8_number_(web8_getField_(record, [
    'Played', 'played', 'HolesPlayed', 'holesPlayed'
  ]), 0);

  if (directPlayed > 0) return directPlayed;

  const candidates = [
    web8_getField_(record, ['HoleScores', 'holeScores']),
    web8_getField_(record, ['Scores', 'scores']),
    web8_getField_(record, ['SortScores', 'sortScores'])
  ];

  let best = 0;

  candidates.forEach(value => {
    if (Array.isArray(value)) {
      const count = value.filter(item => {
        if (item === null || item === undefined || item === '') return false;
        if (typeof item === 'number') return item > 0;
        if (typeof item === 'string') {
          const s = item.trim();
          return s !== '' && s !== '0' && s !== '-' && s !== '·';
        }
        if (typeof item === 'object') {
          const score = web8_getField_(item, [
            'Score', 'score', 'Strokes', 'strokes', 'Result', 'result'
          ]);
          return score !== undefined && score !== null && String(score) !== '';
        }
        return false;
      }).length;

      if (count > best) best = count;
      return;
    }

    if (typeof value === 'string') {
      const parts = value
        .split(/[|,;\s]+/)
        .map(x => x.trim())
        .filter(x => x && x !== '0' && x !== '-' && x !== '·');

      if (parts.length > best) best = parts.length;
    }
  });

  return best;
}

function web8_liveRecordSummary_(record) {
  if (!record || typeof record !== 'object') return {};

  const keys = Object.keys(record);

  return {
    keys: keys.slice(0, 80),
    playedRaw: web8_getField_(record, [
      'Played', 'played', 'HolesPlayed', 'holesPlayed'
    ]),
    derivedPlayed: web8_derivePlayedFromScores_(record),
    roundToPar: web8_scoreNumber_(web8_getField_(record, [
      'RoundtoPar', 'RoundToPar', 'roundToPar', 'roundtopar'
    ])),
    toPar: web8_scoreNumber_(web8_getField_(record, [
      'ToPar', 'toPar', 'topar', 'TotalToPar', 'totalToPar'
    ])),
    runningPlace: web8_getField_(record, [
      'RunningPlace', 'runningPlace', 'Place', 'place'
    ]),
    completed: web8_getField_(record, [
      'Completed', 'completed', 'IsComplete', 'isComplete'
    ]),
    holeScoresType: typeof web8_getField_(record, [
      'HoleScores', 'holeScores'
    ]),
    scoresType: typeof web8_getField_(record, [
      'Scores', 'scores'
    ])
  };
}

function web8_objectContainsExactFieldValue_(value, names, wantedValue, maxDepth) {
  const wantedKeys = {};
  (names || []).forEach(name => {
    wantedKeys[web8_normalizeKey_(name)] = true;
  });

  const wanted = String(wantedValue);
  let found = false;

  function walk(node, depth) {
    if (
      found ||
      depth > maxDepth ||
      node === null ||
      node === undefined
    ) {
      return;
    }

    if (Array.isArray(node)) {
      node.slice(0, 500).forEach(item => walk(item, depth + 1));
      return;
    }

    if (typeof node !== 'object') return;

    Object.keys(node).forEach(key => {
      if (found) return;

      const child = node[key];

      if (
        wantedKeys[web8_normalizeKey_(key)] &&
        child !== null &&
        child !== undefined &&
        typeof child !== 'object' &&
        String(child) === wanted
      ) {
        found = true;
        return;
      }

      if (child && typeof child === 'object') {
        walk(child, depth + 1);
      }
    });
  }

  walk(value, 0);
  return found;
}

function web8_matchPlayerRecordToRound12_(playerRecord, round12Scores) {
  if (!playerRecord) return null;

  // Strongest bridge: the player endpoint's current ScoreID can be nested
  // inside the full leaderboard row's Rounds / PrevRounds structures rather
  // than exposed as that row's top-level ScoreID.
  const currentScoreId = web8_getField_(playerRecord, [
    'ScoreID', 'scoreId', 'scoreID', 'score_id'
  ]);

  if (
    currentScoreId !== undefined &&
    currentScoreId !== null &&
    String(currentScoreId) !== ''
  ) {
    const deepScoreMatches = [];

    (round12Scores || []).forEach((row, index) => {
      if (
        web8_objectContainsExactFieldValue_(
          row,
          ['ScoreID', 'scoreId', 'scoreID', 'score_id'],
          currentScoreId,
          8
        )
      ) {
        deepScoreMatches.push(index);
      }
    });

    if (deepScoreMatches.length === 1) {
      return {
        record: round12Scores[deepScoreMatches[0]],
        index: deepScoreMatches[0],
        method: 'scoreid-deep'
      };
    }
  }


  const strongKeys = [
    'ResultID',
    'ScoreID'
  ];

  // First try an exact unique match on the current Finals ResultID/ScoreID.
  for (let k = 0; k < strongKeys.length; k++) {
    const key = strongKeys[k];
    const wanted = web8_getField_(playerRecord, [key]);

    if (wanted === undefined || wanted === null || String(wanted) === '') {
      continue;
    }

    const matches = [];

    (round12Scores || []).forEach((row, index) => {
      const value = web8_getField_(row, [key]);

      if (
        value !== undefined &&
        value !== null &&
        String(value) === String(wanted)
      ) {
        matches.push(index);
      }
    });

    if (matches.length === 1) {
      return {
        record: round12Scores[matches[0]],
        index: matches[0],
        method: key.toLowerCase()
      };
    }
  }

  // Then use a multi-field Finals fingerprint. These fields are all present
  // in the full Round-12 rows and many are also present in the player endpoint.
  const compareKeys = [
    'RoundID',
    'LayoutID',
    'CardNum',
    'TeeTime',
    'TeeStart',
    'TeeTimeSort',
    'PreviousPlace',
    'PrevRndTotal',
    'Rating',
    'RoundScore',
    'RoundtoPar',
    'Par'
  ];

  const source = {};
  compareKeys.forEach(key => {
    const value = web8_getField_(playerRecord, [key]);
    if (value !== undefined && value !== null && String(value) !== '') {
      source[key] = String(value);
    }
  });

  const ranked = [];

  (round12Scores || []).forEach((row, index) => {
    let strength = 0;
    let compared = 0;

    Object.keys(source).forEach(key => {
      const value = web8_getField_(row, [key]);

      if (value === undefined || value === null || String(value) === '') {
        return;
      }

      compared++;

      if (String(value) === source[key]) {
        // Give more identifying fields more weight.
        if (key === 'TeeTime' || key === 'TeeTimeSort') strength += 5;
        else if (key === 'PreviousPlace' || key === 'PrevRndTotal') strength += 4;
        else if (key === 'CardNum' || key === 'Rating') strength += 3;
        else strength += 1;
      }
    });

    if (strength > 0 && compared > 0) {
      ranked.push({ index: index, strength: strength });
    }
  });

  ranked.sort((a, b) => b.strength - a.strength);

  if (
    ranked.length &&
    ranked[0].strength >= 7 &&
    (
      ranked.length === 1 ||
      ranked[0].strength > ranked[1].strength
    )
  ) {
    return {
      record: round12Scores[ranked[0].index],
      index: ranked[0].index,
      method: 'fingerprint'
    };
  }

  return null;
}


function web8_findPlayerByReference_(scores, referencePlayer) {
  if (!referencePlayer) return null;

  const referenceTokens = web8_collectIdentityTokens_(referencePlayer);
  if (!referenceTokens.length) return null;

  const candidates = (scores || []).map(player => ({
    player: player,
    tokens: web8_collectIdentityTokens_(player)
  }));

  // Only trust a token if it appears in EXACTLY ONE Finals record.
  // This prevents shared/event-level IDs from mapping every pick to
  // the same Finals player.
  for (let i = 0; i < referenceTokens.length; i++) {
    const token = referenceTokens[i];
    const matches = candidates.filter(candidate =>
      candidate.tokens.indexOf(token) !== -1
    );

    if (matches.length === 1) {
      return matches[0].player;
    }
  }

  return null;
}

function web8_referenceTokenDiagnostics_(scores, referencePlayer) {
  if (!referencePlayer) return [];

  const referenceTokens = web8_collectIdentityTokens_(referencePlayer);
  const candidates = (scores || []).map(player =>
    web8_collectIdentityTokens_(player)
  );

  return referenceTokens.slice(0, 12).map(token => ({
    token: token,
    finalsMatches: candidates.filter(tokens =>
      tokens.indexOf(token) !== -1
    ).length
  }));
}

function web8_collectIdentityTokens_(value) {
  const tokens = [];

  function walk(node, depth, parentKey) {
    if (depth > 6 || node === null || node === undefined) return;

    if (
      typeof node === 'string' ||
      typeof node === 'number'
    ) {
      const key = web8_normalizeKey_(parentKey || '');

      // Restrict this fallback to fields that look like persistent player IDs,
      // not generic scores/places/card IDs that can collide.
      const identityKey =
        key.indexOf('pdga') !== -1 ||
        key.indexOf('member') !== -1 ||
        key === 'playerid' ||
        key === 'userid' ||
        key === 'personid' ||
        key === 'profileid' ||
        key === 'competitorid' ||
        key === 'participantid' ||
        key === 'playernumber' ||
        key === 'membernumber';

      if (identityKey) {
        const token = key + ':' + String(node).trim().toLowerCase();
        if (token && tokens.indexOf(token) === -1) tokens.push(token);
      }

      return;
    }

    if (Array.isArray(node)) {
      node.slice(0, 100).forEach(item => walk(item, depth + 1, parentKey));
      return;
    }

    if (typeof node === 'object') {
      Object.keys(node).forEach(key => walk(node[key], depth + 1, key));
    }
  }

  walk(value, 0, '');
  return tokens;
}

function web8_getPlayerName_(player) {
  return web8_getField_(player, [
    'Name', 'name',
    'PlayerName', 'playerName', 'player_name',
    'FullName', 'fullName', 'full_name',
    'ShortName', 'shortName'
  ]);
}

function web8_getPdgaNumber_(player) {
  const value = web8_getField_(player, [
    'PDGANum', 'PDGANumber', 'PdgaNum', 'pdgaNum',
    'pdga_number', 'pdgaNumber',
    'PDGA', 'pdga',
    'MemberNumber', 'MemberNum', 'memberNumber', 'member_number'
  ]);

  return value === undefined || value === null
    ? ''
    : String(value).replace(/\D/g, '');
}

function web8_getField_(obj, names) {
  if (!obj || typeof obj !== 'object') return undefined;

  const wanted = {};
  names.forEach(name => {
    wanted[web8_normalizeKey_(name)] = true;
  });

  const keys = Object.keys(obj);

  // Prefer top-level fields because score/progress fields live there
  // in normal PDGA round responses.
  for (let i = 0; i < keys.length; i++) {
    if (wanted[web8_normalizeKey_(keys[i])]) {
      return obj[keys[i]];
    }
  }

  // Finals player identity may be nested. Search only a few levels deep
  // as a fallback so we don't accidentally wander into unrelated data.
  function search(value, depth) {
    if (depth > 3 || !value || typeof value !== 'object') return undefined;

    const childKeys = Object.keys(value);

    for (let i = 0; i < childKeys.length; i++) {
      if (wanted[web8_normalizeKey_(childKeys[i])]) {
        return value[childKeys[i]];
      }
    }

    for (let i = 0; i < childKeys.length; i++) {
      const child = value[childKeys[i]];
      if (child && typeof child === 'object') {
        const found = search(child, depth + 1);
        if (found !== undefined) return found;
      }
    }

    return undefined;
  }

  return search(obj, 0);
}

function web8_normalizeKey_(key) {
  return String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function web8_namesEquivalent_(a, b) {
  const na = web8_normalizeName_(a);
  const nb = web8_normalizeName_(b);

  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = na.split(' ').filter(Boolean).sort();
  const tb = nb.split(' ').filter(Boolean).sort();

  if (
    ta.length === tb.length &&
    ta.every((token, i) => token === tb[i])
  ) {
    return true;
  }

  const setA = {};
  const setB = {};

  ta.forEach(token => setA[token] = true);
  tb.forEach(token => setB[token] = true);

  const aInB = ta.every(token => setB[token]);
  const bInA = tb.every(token => setA[token]);

  return (
    (ta.length >= 2 && aInB) ||
    (tb.length >= 2 && bInA)
  );
}

function web8_normalizeName_(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function web8_scoreNumber_(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string') {
    const s = value.trim().toUpperCase();

    if (s === 'E' || s === 'EVEN') return 0;
    if (s === 'DNF' || s === 'DNS' || s === 'DNP') return null;
  }

  const n = Number(value);

  if (!Number.isFinite(n)) return null;
  if (n >= 900) return null;

  return n;
}

function web8_number_(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function web8_bool_(value) {
  if (value === true) return true;

  if (
    value === false ||
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return false;
  }

  if (typeof value === 'number') return value !== 0;

  const s = String(value).trim().toLowerCase();

  return [
    '1', 'true', 'yes', 'y', 'complete', 'completed'
  ].indexOf(s) >= 0;
}

function web8_unwrapJsonStrings_(value, depth) {
  depth = depth || 0;

  if (depth > 3) return value;

  if (typeof value === 'string') {
    const s = value.trim();

    if (
      (s.indexOf('{') === 0 && s.lastIndexOf('}') === s.length - 1) ||
      (s.indexOf('[') === 0 && s.lastIndexOf(']') === s.length - 1)
    ) {
      try {
        return web8_unwrapJsonStrings_(JSON.parse(s), depth + 1);
      } catch (e) {
        return value;
      }
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item =>
      web8_unwrapJsonStrings_(item, depth + 1)
    );
  }

  if (value && typeof value === 'object') {
    Object.keys(value).forEach(key => {
      value[key] = web8_unwrapJsonStrings_(value[key], depth + 1);
    });
  }

  return value;
}
