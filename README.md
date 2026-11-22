# Rhythm Trainer

A metronome that listens to you play and shows how close each note lands to the click.

Live: https://proxrover.github.io/rhythm_trainer/

## What it does
- Metronome from 30 to 300 BPM in ten time signatures.
- Every click: one note value repeated through the bar. Build a bar: up to four bars of notes and rests, with presets.
- Listens through the microphone, marks each note early, on time or late, and keeps a streak of bars played in time.
- Tuner with a ±50 cent gauge.
- Nothing is saved: closing the tab clears every setting and count.

Headphones recommended for the metronome.

## Tests
```sh
bats tests
```

## License
Copyright (c) 2026 Proximity Software Factory LLC. All rights reserved. Proprietary; see LICENSE and COPYRIGHT.md. The embedded fonts are under the SIL Open Font License 1.1 (`licenses/`).
