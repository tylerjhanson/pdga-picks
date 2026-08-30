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
      bridgeVersion: 'direct-v9',
      error: error && error.message ? error.message : String(error)
    };
  }

  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function web8_getPayload_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pdga_picks_direct_v9';
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

    // Contest R1-R4 map normally. Contest R5 is PDGA's special Finals/API 12.
    for (let contestRound = 1; contestRound <= 5; contestRound++) {
      const apiRound = contestRound === 5 ? 12 : contestRound;
      const fetched = web8_fetchRound_(apiRound);
      const scores = web8_extractScores_(fetched.json);

      roundScores[contestRound] = scores;
      roundRaw[contestRound] = fetched.json;

      diagnostics.push({
        contestRound: contestRound,
        apiRound: apiRound,
        http: fetched.code,
        players: scores.length,
        realScoring: web8_roundHasRealScoring_(scores)
      });
    }

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
      ? web8_buildFinalsAssignments_(
          roundScores[5],
          roundRaw[5],
          WEB8_PICKS,
          roundScores[4]
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

        if (
          roundToPar !== null &&
          (round < currentRound || played > 0 || completed)
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

        total = cumulative !== null
          ? cumulative
          : (hasRoundScore ? roundSum : null);

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
      bridgeVersion: 'direct-v9',
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
        return {
          kyleFinalsMatched: !!kyleAssignment,
          kyleMethod: kyleAssignment ? kyleAssignment.method : '',
          kyleFinalsIndex: kyleAssignment ? kyleAssignment.index : null,
          assignedFinalists: Object.keys(finalsAssignments).length,
          kyleR4ResultId: finalsAssignments._debug
            ? finalsAssignments._debug.kyleR4ResultId
            : '',
          kyleResultIdMatches: finalsAssignments._debug
            ? finalsAssignments._debug.kyleResultIdMatches
            : 0
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

function web8_buildFinalsAssignments_(scores, rawRoot, picks, round4Scores) {
  const assignments = {};
  const used = {};
  const scoreList = scores || [];

  function assign(pick, index, method, resultId) {
    if (!pick || index === null || index === undefined) return false;
    if (index < 0 || index >= scoreList.length) return false;
    if (used[index] || assignments[pick.pdga]) return false;

    assignments[pick.pdga] = {
      player: scoreList[index],
      index: index,
      method: method,
      resultId: resultId == null ? '' : String(resultId)
    };
    used[index] = true;
    return true;
  }

  // 1) Best Finals join: ResultID is the event-result record and should
  // remain stable for a player across rounds, even when Finals blanks
  // Name / PDGANum / ProfileURL.
  picks.forEach(pick => {
    const r4 = web8_findPlayer_(round4Scores || [], pick);
    if (!r4) return;

    const r4ResultId = web8_getField_(r4, [
      'ResultID', 'resultId', 'resultID', 'result_id'
    ]);

    if (
      r4ResultId === null ||
      r4ResultId === undefined ||
      String(r4ResultId) === ''
    ) {
      return;
    }

    const matches = [];

    scoreList.forEach((row, index) => {
      const finalsResultId = web8_getField_(row, [
        'ResultID', 'resultId', 'resultID', 'result_id'
      ]);

      if (
        finalsResultId !== null &&
        finalsResultId !== undefined &&
        String(finalsResultId) === String(r4ResultId)
      ) {
        matches.push(index);
      }
    });

    if (matches.length === 1) {
      assign(pick, matches[0], 'result-id', r4ResultId);
    }
  });

  // 2) Direct identity fallback in case PDGA later restores Finals names/PDGA.
  picks.forEach(pick => {
    if (assignments[pick.pdga]) return;

    const matches = [];

    scoreList.forEach((row, index) => {
      if (used[index]) return;
      if (web8_findPlayer_([row], pick)) matches.push(index);
    });

    if (matches.length === 1) {
      assign(pick, matches[0], 'direct', '');
    }
  });

  // Diagnostics for Kyle: show the R4 ResultID and how many Finals rows
  // carry that exact same ResultID.
  const kylePick = picks.find(p => String(p.pdga) === '85132');
  const kyleR4 = kylePick
    ? web8_findPlayer_(round4Scores || [], kylePick)
    : null;

  const kyleR4ResultId = kyleR4
    ? web8_getField_(kyleR4, [
        'ResultID', 'resultId', 'resultID', 'result_id'
      ])
    : null;

  let kyleResultIdMatches = 0;

  if (
    kyleR4ResultId !== null &&
    kyleR4ResultId !== undefined &&
    String(kyleR4ResultId) !== ''
  ) {
    scoreList.forEach(row => {
      const finalsResultId = web8_getField_(row, [
        'ResultID', 'resultId', 'resultID', 'result_id'
      ]);

      if (
        finalsResultId !== null &&
        finalsResultId !== undefined &&
        String(finalsResultId) === String(kyleR4ResultId)
      ) {
        kyleResultIdMatches++;
      }
    });
  }

  Object.defineProperty(assignments, '_debug', {
    value: {
      kyleR4ResultId:
        kyleR4ResultId == null ? '' : String(kyleR4ResultId),
      kyleResultIdMatches: kyleResultIdMatches
    },
    enumerable: false
  });

  return assignments;
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
