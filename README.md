# SmartCube Gym

Train intuition, blockbuilding, and efficiency with a smart cube.

SmartCube Gym is a browser-based training platform for intuitive Rubik's Cube methods, including Petrus, Roux, LEOR, APB, and ZZ. Unlike traditional trainers that focus on algorithm memorisation or full solves, SmartCube Gym focuses on the skills that make intuitive methods effective:

- Blockbuilding
- Edge Orientation (EO)
- Piece tracking
- Move efficiency
- Planning ahead
- Method-specific solving stages

Connect a compatible smart cube and receive live, solver-driven feedback while you practise.

---

## Why SmartCube Gym?

Most cubing tools are designed around complete solves and algorithm drilling.

SmartCube Gym takes a different approach.

Instead of asking:

> Can you solve the cube?

it asks:

> Can you build this block efficiently?

> Can you orient all edges quickly?

> Can you find a shorter solution?

> Can you recognise opportunities you missed?

The goal is deliberate practice of the core skills used by intuitive solving methods.

---

## Features

### Smart Cube Support

- Browser-based Bluetooth connectivity
- Multi-brand smart cube support: GAN, MoYu, QiYi, Giiker/Mi, GoCube
- No installation required
- Runs entirely in your browser

### Solver-Driven Coaching

The built-in solver continuously analyses your progress and can:

- Measure move efficiency
- Compare your solution against optimal
- Track improvement over time
- Provide hints and guidance
- Evaluate alternative solutions

No cloud services, AI models, or external APIs are required.

### Blockbuilding Practice

Train specific skills rather than complete solves:

- 2×2×2 blocks
- 2×2×3 blocks
- 1×2×3 blocks
- Edge Orientation (EO)
- EOLine
- EOCross
- Method-specific building stages

### Multiple Methods

Current and planned support includes:

- Petrus
- Roux
- LEOR
- APB
- ZZ

The training engine is goal-based, allowing new exercises and solving stages to be added without redesigning the application.

### Coaching Modes

- Guided practice
- Free practice
- Live progress tracking
- Hint generation
- Efficiency scoring
- Statistics and performance history

---

## Example Training Session

1. Connect your smart cube.
2. Select a training goal.
3. Generate a scramble.
4. Build the target structure.
5. Receive immediate feedback.
6. Compare your solution with optimal.
7. Repeat.

The objective is not necessarily to finish the cube.

The objective is to improve the individual skills that make efficient solving possible.

---

## Supported Training Goals

Current goals include:

- 2×2×2 Block
- 2×2×3 Block
- 1×2×3 Block
- Edge Orientation (EO)
- EOLine
- EOCross

Additional goals and method-specific stages are planned.

---

## How It Works

SmartCube Gym represents solving goals as cube-state constraints.

Examples include:

- Build any valid 2×2×2 block.
- Build any valid 2×2×3 block.
- Build a valid 1×2×3 block.
- Orient all edges.
- Create an EOLine.
- Create an EOCross.

The solver continuously evaluates cube state against these goals and can measure both completion and efficiency.

Because goals are represented generically, the same coaching system can support multiple solving methods.

---

## Philosophy

SmartCube Gym is built around a simple idea:

> Algorithms are easy to memorise. Intuition is harder to train.

Most cubers spend thousands of solves practising complete solutions.

Very few spend focused time practising:

- Blockbuilding
- EO recognition
- Piece tracking
- Efficient move selection
- Planning and lookahead

SmartCube Gym exists to make that practice possible.

---

## Privacy

Everything runs locally in your browser.

- No accounts
- No telemetry
- No cloud processing
- No external AI services

Your cube data remains on your device.

---

## Development

### Prerequisites

- Node.js 18+
- A modern Chromium-based browser with Web Bluetooth support
- A compatible smart cube

### Installation

```bash
git clone https://github.com/ianjohndawson/smartcube-gym.git
cd smartcube-gym
npm install
```

### Development Server

```bash
npm run dev
```

### Production Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

---

## Roadmap

Planned and experimental areas include:

- Additional smart cube support
- Expanded LEOR and APB training paths
- Advanced coaching metrics
- Session analysis
- Enhanced statistics and progress tracking
- Additional method-specific training goals

---

## Contributing

Contributions, bug reports, feature requests, and method ideas are welcome.

If you find a bug or have a suggestion, please open an issue.

---

## Acknowledgements

SmartCube Gym incorporates and builds upon components derived from the CrystalCube project.

The engine code located in `src/engine/` retains its original MPL-2.0 licensing and attribution requirements. See `src/engine/ATTRIBUTION.md` for details.

The CrystalCube-derived engine provides the solver infrastructure that powers SmartCube Gym's analysis, evaluation, and coaching capabilities.

---

## License

SmartCube Gym is licensed under **GPL-3.0-or-later**. See the `LICENSE` file for details.

Parts of this project have different licensing requirements:

- The code in `src/engine/` is derived from CrystalCube and remains licensed under **MPL-2.0**.
- Attribution and licensing details for the engine code can be found in `src/engine/ATTRIBUTION.md`.
- MPL-2.0 §3.3 permits inclusion of MPL-covered files within a GPL-licensed larger work.

Unless otherwise noted, all original SmartCube Gym code outside `src/engine/` is licensed under GPL-3.0-or-later.
