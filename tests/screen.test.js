'use strict';
// Coverage for pure helpers in screen.js: pitch-name formatting, chart
// event building/sorting, cursor positioning, forward event scanning.
// Runs under the org reusable CI as `node tests/screen.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin({ notes = [], chords = [], audioTime = 0 } = {}) {
    global.window = { __stepModeInstalled: false };
    global.document = {
        getElementById: (id) => (id === 'audio' ? { currentTime: audioTime } : null),
        addEventListener: () => {},
    };
    global.highway = { getNotes: () => notes, getChords: () => chords };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

test('stringFretToName resolves standard 6-string guitar pitches', () => {
    const mod = freshPlugin();
    assert.equal(mod.stringFretToName(0, 0, 'Lead Guitar', null, 0), 'E2'); // low E open
    assert.equal(mod.stringFretToName(0, 3, 'Lead Guitar', null, 0), 'G2');
    assert.equal(mod.stringFretToName(5, 0, 'Lead Guitar', null, 0), 'E4'); // high E open
});

test('stringFretToName honors tuning offsets and capo', () => {
    const mod = freshPlugin();
    const dropD = [-2, 0, 0, 0, 0, 0]; // low E dropped 2 semitones to D
    assert.equal(mod.stringFretToName(0, 0, 'Lead Guitar', dropD, 0), 'D2');
    assert.equal(mod.stringFretToName(0, 0, 'Lead Guitar', null, 2), 'F#2'); // capo 2
});

test('stringFretToName detects bass arrangements by name and uses 4-string tuning', () => {
    const mod = freshPlugin();
    assert.equal(mod.stringFretToName(0, 0, 'Bass', null, 0), 'E1');
    assert.equal(mod.stringFretToName(0, 0, 'Bass Guitar', null, 0), 'E1');
});

test('stringFretToName supports 7-string guitar and 5-string bass via tuning length', () => {
    const mod = freshPlugin();
    const seven = [0, 0, 0, 0, 0, 0, 0];
    assert.equal(mod.stringFretToName(0, 0, 'Lead Guitar', seven, 0), 'B1'); // low B string
    const fiveBass = [0, 0, 0, 0, 0];
    assert.equal(mod.stringFretToName(0, 0, 'Bass', fiveBass, 0), 'B0');
});

test('stringFretToName returns ? for an out-of-range string index', () => {
    const mod = freshPlugin();
    assert.equal(mod.stringFretToName(-1, 0, 'Lead Guitar', null, 0), '?');
    assert.equal(mod.stringFretToName(6, 0, 'Lead Guitar', null, 0), '?');
});

test('rebuildChartEvents merges notes+chords sorted by time, dropping muted', () => {
    const mod = freshPlugin({
        notes: [
            { t: 2.0, s: 0, f: 3 },
            { t: 0.5, s: 1, f: 0 },
            { t: 1.0, s: 0, f: 0, mt: true }, // muted -> dropped
        ],
        chords: [
            { t: 1.5, notes: [{ s: 0, f: 0 }, { s: 1, f: 0, mt: true }] },
        ],
    });
    mod.rebuildChartEvents();
    const { chartEvents } = mod._getState();
    assert.deepEqual(chartEvents.map(e => e.t), [0.5, 1.5, 2.0]);
    assert.deepEqual(chartEvents[1].notes, [{ s: 0, f: 0 }]); // muted chord member dropped
});

test('rebuildChartEvents drops chords whose every member is muted', () => {
    const mod = freshPlugin({
        chords: [{ t: 1.0, notes: [{ s: 0, f: 0, mt: true }] }],
    });
    mod.rebuildChartEvents();
    assert.deepEqual(mod._getState().chartEvents, []);
});

test('resetCursor binary-searches to the first event at/after the current audio time', () => {
    const mod = freshPlugin({
        notes: [{ t: 0 }, { t: 1 }, { t: 2 }, { t: 3 }],
        audioTime: 1.5,
    });
    mod.rebuildChartEvents(); // calls resetCursor internally
    assert.equal(mod._getState().nextEventIdx, 2); // first event with t >= 1.5 is t=2
});

test('findNextEvent walks the cursor forward past stale events (RAF-hitch tolerance)', () => {
    const mod = freshPlugin({
        notes: [{ t: 0 }, { t: 1 }, { t: 2 }, { t: 3 }],
    });
    mod.rebuildChartEvents();
    // Simulate a big jump forward (RAF hitch): current time is now 2.8,
    // well past events at t=0/1, and the 0.5s tolerance window skips them.
    const ev = mod.findNextEvent(2.8);
    assert.equal(ev.t, 3);
});

test('findNextEvent returns null once the cursor runs off the end of the chart', () => {
    const mod = freshPlugin({ notes: [{ t: 0 }] });
    mod.rebuildChartEvents();
    assert.equal(mod.findNextEvent(0).t, 0);
    assert.equal(mod.findNextEvent(100), null);
});

test('rebuildChartEvents tolerates a missing highway global', () => {
    global.window = { __stepModeInstalled: false };
    global.document = { getElementById: () => null, addEventListener: () => {} };
    delete global.highway; // simulate the global genuinely being absent
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    mod.rebuildChartEvents();
    assert.deepEqual(mod._getState().chartEvents, []);
});
