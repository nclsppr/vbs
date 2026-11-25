// Sound: a small music box that plays the carols listed in /music, and the
// clicks and chimes of the set. Browsers only allow sound after a press of a
// button, so nothing exists before unlock().

import { clamp } from './util.mjs';

const AHEAD = 1.5; // seconds of music handed to the sound card in advance
const OCTAVE_UP = 12; // the carols are written for voices; a music box sings higher

/** Reads the events of one track into `events`. */
function readTrack(data, start, end, events) {
  let at = start;
  let tick = 0;
  let status = 0;
  const number = () => {
    let value = 0;
    for (;;) {
      const byte = data.getUint8(at);
      at += 1;
      value = (value << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
  };

  while (at < end) {
    tick += number();
    const first = data.getUint8(at);
    if (first === 0xff) {
      const type = data.getUint8(at + 1);
      at += 2;
      const size = number();
      if (type === 0x51) {
        events.push({ tick, order: 0, tempo: (data.getUint8(at) << 16) | (data.getUint8(at + 1) << 8) | data.getUint8(at + 2) });
      }
      at += size;
    } else if (first === 0xf0 || first === 0xf7) {
      at += 1;
      const size = number();
      at += size;
    } else {
      // A data byte here means "same kind of event as the previous one".
      if (first & 0x80) {
        status = first;
        at += 1;
      }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const pitch = data.getUint8(at);
      const force = kind === 0xc0 || kind === 0xd0 ? 0 : data.getUint8(at + 1);
      at += kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      if (channel === 9) continue; // drums
      const voice = channel * 128 + pitch;
      if (kind === 0x90 && force > 0) events.push({ tick, order: 2, voice, pitch, force: force / 127 });
      else if (kind === 0x80 || kind === 0x90) events.push({ tick, order: 1, voice });
    }
  }
}

/** The notes of a standard MIDI file, timed in seconds from the first one. */
export function parseMidi(buffer) {
  const data = new DataView(buffer);
  const tag = (at) => String.fromCharCode(...[0, 1, 2, 3].map((i) => data.getUint8(at + i)));
  if (tag(0) !== 'MThd') throw new Error('Not a MIDI file.');
  const division = data.getUint16(12);
  if (division & 0x8000) throw new Error('MIDI files timed in frames are not supported.');

  const events = [];
  for (let at = 8 + data.getUint32(4); at + 8 <= data.byteLength; ) {
    const end = at + 8 + data.getUint32(at + 4);
    if (tag(at) === 'MTrk') readTrack(data, at + 8, Math.min(end, data.byteLength), events);
    at = end;
  }
  // At the same instant: tempo first, then the notes that end, then the new ones.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const notes = [];
  const sounding = new Map();
  let tempo = 500000;
  let tick = 0;
  let time = 0;
  for (const event of events) {
    time += ((event.tick - tick) * tempo) / division / 1e6;
    tick = event.tick;
    if (event.tempo) {
      tempo = event.tempo;
      continue;
    }
    const held = sounding.get(event.voice);
    if (held) {
      held.length = time - held.at;
      sounding.delete(event.voice);
    }
    if (event.order === 2) {
      const note = { at: time, length: 0.5, pitch: event.pitch, force: event.force };
      sounding.set(event.voice, note);
      notes.push(note);
    }
  }
  const lead = notes.length ? notes[0].at : 0;
  for (const note of notes) note.at -= lead;
  return { notes, length: notes.reduce((end, note) => Math.max(end, note.at + note.length), 0) };
}

export function createSound() {
  let audio = null;
  let master = null;
  let music = null;
  let hiss = null;
  let volume = 0.7;
  let wanted = false; // true while the set is on
  let playlist = null;
  let current = -1;
  let turn = 0;
  let line = null; // gain carrying the tune being played
  let cursor = 0;
  let origin = 0;
  let announce = () => {};

  const level = () => volume ** 1.6;

  /** One tooth of the comb: a pure note with a short bright "ting" on top. */
  function chime(pitch, when, length, force, out) {
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    const ring = clamp(length * 1.1 + 0.5, 0.6, 2.4);
    const loudness = force * 0.13;
    for (const [multiple, share, fade] of [[1, 1, ring], [4, 0.3, 0.22]]) {
      const envelope = audio.createGain();
      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(loudness * share, when + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0004, when + fade);
      envelope.connect(out);
      const tooth = audio.createOscillator();
      tooth.frequency.value = frequency * multiple;
      tooth.connect(envelope);
      tooth.start(when);
      tooth.stop(when + fade + 0.03);
    }
  }

  function beep(frequency, when, length, loudness, shape = 'square', slideTo = frequency) {
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(loudness, when + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0004, when + length);
    envelope.connect(master);
    const voice = audio.createOscillator();
    voice.type = shape;
    voice.frequency.setValueAtTime(frequency, when);
    voice.frequency.exponentialRampToValueAtTime(slideTo, when + length);
    voice.connect(envelope);
    voice.start(when);
    voice.stop(when + length + 0.03);
  }

  function crackle(when, length, loudness) {
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(loudness, when);
    envelope.gain.exponentialRampToValueAtTime(0.0004, when + length);
    envelope.connect(master);
    const source = audio.createBufferSource();
    source.buffer = hiss;
    source.connect(envelope);
    source.start(when, Math.random() * 0.3, length + 0.05);
  }

  const effects = {
    tick: (t) => beep(1320, t, 0.045, 0.045),
    open: (t) => {
      beep(660, t, 0.07, 0.045);
      beep(990, t + 0.06, 0.09, 0.045);
    },
    back: (t) => {
      beep(990, t, 0.07, 0.045);
      beep(660, t + 0.06, 0.09, 0.045);
    },
    zap: (t) => crackle(t, 0.16, 0.06),
    on: (t) => {
      crackle(t, 0.5, 0.05);
      beep(52, t, 0.7, 0.3, 'sine', 118);
    },
    off: (t) => beep(240, t, 0.4, 0.2, 'sine', 38),
    vote: (t) => [84, 88, 91, 96].forEach((pitch, i) => chime(pitch, t + i * 0.085, 0.5, 1, master)),
    pull: (t) => {
      beep(880, t, 0.08, 0.045);
      beep(587, t + 0.08, 0.14, 0.045);
    },
    error: (t) => beep(150, t, 0.24, 0.08, 'sawtooth', 110),
  };

  function silence() {
    if (line) line.gain.setTargetAtTime(0, audio.currentTime, 0.04);
    line = null;
  }

  async function play(index) {
    silence();
    turn += 1;
    const mine = turn;
    if (!playlist.length) {
      announce('');
      return;
    }
    current = ((index % playlist.length) + playlist.length) % playlist.length;
    const entry = playlist[current];
    announce(entry.name);
    if (!entry.tune) {
      try {
        const response = await fetch(`/music/${entry.file}`);
        if (!response.ok) throw new Error(response.statusText);
        entry.tune = parseMidi(await response.arrayBuffer());
      } catch {
        entry.tune = { notes: [], length: 0 };
      }
    }
    if (mine !== turn || !wanted) return;
    if (!entry.tune.notes.length) {
      // Unreadable: take it off the list and move on.
      playlist.splice(current, 1);
      play(current);
      return;
    }
    line = audio.createGain();
    line.connect(music);
    cursor = 0;
    origin = audio.currentTime + 0.3;
  }

  /** Hands the notes due soon to the sound card; called several times a second. */
  function pump() {
    if (!line) return;
    const { tune } = playlist[current];
    const horizon = audio.currentTime + AHEAD;
    for (; cursor < tune.notes.length && origin + tune.notes[cursor].at < horizon; cursor += 1) {
      const note = tune.notes[cursor];
      chime(note.pitch + OCTAVE_UP, Math.max(audio.currentTime, origin + note.at), note.length, note.force, line);
    }
    if (cursor >= tune.notes.length && audio.currentTime > origin + tune.length + 1.8) play(current + 1);
  }

  return {
    /** Call from a click or a key press: this is what lets the page make sound. */
    unlock() {
      if (audio) {
        audio.resume();
        return;
      }
      audio = new AudioContext();
      master = audio.createGain();
      master.gain.value = level();
      master.connect(audio.destination);

      // The music goes through a soft echo, like a box on a wooden table.
      music = audio.createGain();
      music.connect(master);
      const echo = audio.createDelay(1);
      echo.delayTime.value = 0.27;
      const fade = audio.createGain();
      fade.gain.value = 0.24;
      const soften = audio.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 2400;
      music.connect(echo);
      echo.connect(soften);
      soften.connect(fade);
      fade.connect(echo);
      fade.connect(master);

      hiss = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
      const samples = hiss.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
      setInterval(pump, 120);
    },

    /** Start the carols (the set is on). */
    async start() {
      wanted = true;
      if (!playlist) {
        try {
          const response = await fetch('/music/playlist.json');
          playlist = response.ok ? await response.json() : [];
        } catch {
          playlist = [];
        }
      }
      if (wanted) play(current < 0 ? 0 : current);
    },

    stop() {
      wanted = false;
      turn += 1;
      silence();
    },

    next() {
      if (wanted && playlist) play(current + 1);
    },

    /** One of the set's own sounds, by name. */
    effect(name) {
      if (audio) effects[name](audio.currentTime + 0.01);
    },

    setVolume(value) {
      volume = value;
      if (master) master.gain.setTargetAtTime(level(), audio.currentTime, 0.03);
    },

    /** `listener(name)` is told the carol being played ('' when there is none). */
    onTune(listener) {
      announce = listener;
    },
  };
}
