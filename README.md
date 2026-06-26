# MotionSmith: Character Motion Designer

![MotionSmith Dashboard](https://github.com/moh-d-m4x/MotionSmith/blob/main/ref/MotionSmith_Dashboard.png?raw=true)

**MotionSmith** is a powerful web-based tool for designing, simulating, and optimizing mechanical linkages and character motion. It combines interactive 2D physics simulation with genetic algorithms to help users create complex mechanisms that follow specific motion paths.

<p align="center">
  <a href="https://moh-d-m4x.github.io/MotionSmith/">
    <img src="https://img.shields.io/badge/🚀_Try_it-live!-blue?style=for-the-badge" alt="Try it live!" height="50">
  </a>
</p>

## 🚀 Features

### 🛠️ Interactive Mechanism Design
- **Multiple Mechanism Types**: Support for 4-bar, 5-bar, Piston, and Scotch Yoke mechanisms.
- **Drag-and-Drop Editor**: Intuitively adjust link lengths, anchor points, and joint positions directly on the canvas.
- **Real-time Simulation**: Visualize motion instantly as you modify the design.
- **Parametric Controls**: Fine-tune specific values like crank length, ground distance, and speed ratios.

![Draw Mode](https://github.com/moh-d-m4x/MotionSmith/blob/main/ref/Draw_Mode.png?raw=true)

### 🧬 Machine Optimization
- **Path Drawing**: Draw a desired motion path directly on the canvas.
- **Genetic Algorithm**: Automatically evolve mechanism configurations to match your drawn path.
- **Smart Generation**: Uses Monte Carlo search and evolutionary strategies to find the best fit.
- **Shape Preservation**: Optimization algorithms respect the "DNA" of mechanism types, preserving speed ratios and key characteristics while fitting the curve.

### ✍️ Manual Motion Tracking
- **Import Video/GIF**: Upload reference footage of motion.
- **Manual Annotation**: Click to define points on video frames.
- **Path Smoothing**: Automatically smooth your manually placed points using Catmull-Rom splines.
- **Path Extraction**: Convert your annotated path into a target for mechanism optimization.
- **Loop Closing**: Option to automatically connect the start and end points for cyclic motion.

![Tracking Modal](https://github.com/moh-d-m4x/MotionSmith/blob/main/ref/Tracking_Modal_1.png?raw=true)
![Tracking Moda2](https://github.com/moh-d-m4x/MotionSmith/blob/main/ref/Tracking_Modal_2.png?raw=true)

### 📤 Export & Integration (alpha)
- **SVG Export**: Export your mechanism and path as scalable vector graphics.
- **DXF Export**: Generate CAD-ready files for laser cutting or 3D modeling.
- **Presets**: Save and load your favorite mechanism configurations.

## 📦 Getting Started

### Prerequisites
- **Node.js**: v16 or higher

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/yourusername/motionsmith.git
    cd motionsmith
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

### Running the Application

**Quick Start (Windows):**
```bash
run_browser.bat
```

**Manual Start:**

```bash
# In the root directory
npm run dev
```
Open `http://localhost:3000` in your browser.

## 📖 Usage Guide

### Designing a Mechanism
1.  **Select a Mechanism**: Choose from presets like "Crank-Rocker" or "Piston Pusher" in the left sidebar.
2.  **Modify**: Click "Draw Mode" to toggle interaction. Drag joints to resize or anchors to move.
3.  **Adjust**: Use the sliders in the sidebar for precise control over lengths and angles.

### Optimizing for a Path
1.  **Draw**: Enable "Draw Mode" and sketch a loop or curve on the canvas.
2.  **Select**: Click on the mechanism you want to fit to the path.
3.  **Optimize**: Click the "Optimize" button. to iterate through variations to match your drawing.
4.  **Refine**: Adjust the optimization duration or seed mechanism for better results.

### Using Manual Tracking
1.  **Open Tracker**: Click the "Track Video" button in the controls.
2.  **Upload**: Select a video file or GIF containing the motion you want to replicate.
3.  **Annotate**: 
    - Click on the canvas to place a points.
    - Drag points to adjust them.
4.  **Refine**:
    - Check "Smooth Path" to create a smooth curve through your points.
    - Check "Connect Ends" if the motion is a closed loop.
5.  **Transfer**: Click "Transfer as Drawing" to send the tracked path to the main editor for optimization.

## 🛠️ Technology Stack

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS, Lucide React
- **Simulation**: Custom kinematic solvers

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
