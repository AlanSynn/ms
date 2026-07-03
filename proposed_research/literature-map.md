# Literature Map: AI-Assisted Mechanism Generation

This map separates **fact** (directly supported by cited sources), **inference** (research synthesis), and **MotionSmith relevance** (what the source suggests for this product). It is intentionally conservative: no claim of novelty or capability is made without an explicit source.

## 1. Motion-to-mechanism and mechanical-character systems

| Source | Fact | MotionSmith relevance |
|---|---|---|
| Coros et al., 2013, *Computational Design of Mechanical Characters*, ACM TOG/SIGGRAPH. Source: CDFG project page and paper: <https://cdfg.mit.edu/publications/computational-design-mechanical-characters> | The system lets non-expert users create animated mechanical characters from articulated characters plus sketched motion curves; it optimizes mechanisms for those curves and connects mechanisms with gear trains driven by one input. | This is the closest precedent to MotionSmith. It supports a motion-first interface, single-driver mechanism groups, and gear-train connection as the correct research baseline. |
| Thomaszewski et al., 2014, *Computational Design of Linkage-Based Characters*, ACM TOG/SIGGRAPH. Source: Disney/ETH pages: <https://la.disneyresearch.com/publication/computational-design-of-linkage-based-characters/> | Presents a design system for linkage-based characters that combines form and function for compelling motions. | Useful for characters that should visually read as the mechanism, not as a decorative overlay. Reinforces the need to co-design shape and linkage. |
| Zhu et al., 2012, *Motion-Guided Mechanical Toy Modeling*, ACM TOG/SIGGRAPH Asia. Source: Microsoft Research: <https://www.microsoft.com/en-us/research/publication/motion-guided-mechanical-toy-modeling/> | Synthesizes mechanical toys from time-varying feature motions; selects from parameterized parts including belt-pulleys, gears, crank-sliders, quickreturns, and cams; uses simulated annealing. | Supports a library-of-elemental-mechanisms approach and a search/optimization layer that chooses mechanisms from desired motions. |
| Ceylan et al., 2013, *Designing and Fabricating Mechanical Automata from Mocap Sequences*, ACM TOG/SIGGRAPH Asia. Source: project page: <https://www.duygu-ceylan.com/duygu-ceylan/mechAuto.html> | Converts motion-capture sequences into mechanical automata and fabricated assemblies. | Suggests MotionSmith can use character keyframes or IK trajectories as input, but must simplify for classroom fabrication. |
| Song et al., 2017, *Computational Design of Wind-up Toys*, ACM TOG/SIGGRAPH Asia. Source: UCL/SUTD project page: <https://geometry.cs.ucl.ac.uk/projects/2017/wind-up-toys/> | Builds compact internal wind-up mechanisms from user-requested part motions, uses motion-transfer trees, models elemental mechanisms, and optimizes geometry for weight/collision/fabrication. | Strong reference for composing multiple mechanisms and validating collision/compactness instead of only matching a path. |
| Zhang et al., 2017, *Functionality-aware Retargeting of Mechanisms to 3D Shapes*, ACM TOG/SIGGRAPH. Source: project page: <https://cdl.ethz.ch/publications/functionality-aware-retargeting-of-mechanisms-to-3d-shapes/> | Retargets existing mechanical templates to user-provided shapes using parameterized mechanisms, physical validity constraints, spatial relationships, and functional constraints. | Supports template retargeting when a user imports a new character. This is more realistic than unconstrained free generation for early MotionSmith. |

## 2. Interactive linkage editing and classical/deterministic synthesis

| Source | Fact | MotionSmith relevance |
|---|---|---|
| Bächer, Coros, Thomaszewski, 2015, *LinkEdit: Interactive Linkage Editing using Symbolic Kinematics*, ACM TOG/SIGGRAPH. Source: Disney Research: <https://la.disneyresearch.com/publication/linkedit/> | Provides interactive editing of planar linkages; users can edit joint positions, selected point motion, or enclosure while preserving functional aspects; symbolic kinematics enables interactive performance and protects against degenerate configurations. | This is a direct model for MotionSmith parametric handles: drag/edit must preserve closure, lengths, and function in real time. |
| Cheng et al., 2022, *Exact 3D Path Generation via 3D Cam-Linkage Mechanisms*, ACM TOG/SIGGRAPH Asia. Source: project page/code: <https://sutd-cgl.github.io/supp/Publication/projects/2022-SIGAsia-3DCamLinkage/index.html> | Designs 3D cam-linkage mechanisms that exactly generate prescribed 3D paths using 3D cams and links, optimized for smooth, collision-free, singularity-free motion; provides source code. | Good long-term reference for 3D/cam features, but its fabrication complexity exceeds the current 15x15 educational board kit. |
| Park & Jang, 2026, *Automated synthesis of planar linkage mechanisms with diverse joint types via spring-connected link models and contrastive graph learning*, Journal of Computational Design and Engineering. Source: <https://academic.oup.com/jcde/article/13/4/252/8554182> | Combines spring-connected link model dataset generation, contrastive graph learning retrieval, and PSO+SQP refinement for planar linkages with revolute, prismatic, and pin-slot joints. | Useful for future slider/pin-slot mechanisms and stable optimization. It also warns that physical feasibility must be modeled during retrieval and refinement. |

## 3. Learning-based mechanism synthesis

| Source | Fact | MotionSmith relevance |
|---|---|---|
| Nobari et al., 2022, *LINKS: A Dataset of a Hundred Million Planar Linkage Mechanisms for Data-Driven Kinematic Design*. Source: MIT DeCoDE and arXiv: <https://decode.mit.edu/projects/links/> | Introduces 100M 1-DOF planar linkage mechanisms and 1.1B coupler curves; includes simulation data and normalized/curated paths; code and reduced data are public. | A retrieval corpus can be used as a research baseline, but raw LINKS designs may not satisfy MotionSmith's kit/z-stack/fabrication rules. |
| Nobari et al., 2024, *LInK: Learning Joint Representations of Design and Performance Spaces through Contrastive Learning for Mechanism Synthesis*. Source: arXiv: <https://arxiv.org/html/2405.20592v2> | Learns a joint contrastive representation for target curves and mechanism graphs, retrieves from a 10M mechanism subset, and refines with optimization; reports much lower error and faster solving than a prior benchmark. | Strong candidate architecture: retrieve candidates from embeddings, then run deterministic local optimization and fabrication filters. |
| Jiong Lin, Jialong Ning, Judah Goldfeder, Hod Lipson, 2025, *Creative Synthesis of Kinematic Mechanisms*. Source: arXiv: <https://arxiv.org/html/2510.03308v2> | Formulates mechanism synthesis as cross-domain generation between mechanism images and motion curves using shared-latent VAEs; includes image/video-oriented dataset ideas and reports limitations such as blurry samples and occlusion ambiguity. | Useful as an exploratory generative direction, but image-only representations are risky for exact fabrication. MotionSmith should decode to typed DSL/graphs, not only images. |
| Bolanos, Ataei, Jayaraman, 2025 arXiv / AAAI 2026, *MechaFormer: Sequence Learning for Kinematic Mechanism Design Automation*. Source: <https://ojs.aaai.org/index.php/AAAI/article/view/39059> | Treats mechanism design as conditional sequence generation from target curve to a DSL string, generating topology and geometric parameters; outputs can seed traditional optimizers. | The clearest modern precedent for MotionSmith's proposed mechanism DSL. It suggests target-curve-to-DSL is more plausible than unconstrained text-to-mechanism. |

## 4. Text-to-CAD and CAD-as-code AI

| Source | Fact | MotionSmith relevance |
|---|---|---|
| Khan et al., 2024, *Text2CAD: Generating Sequential CAD Designs from Beginner-to-Expert Level Text Prompts*, NeurIPS. Source: <https://proceedings.neurips.cc/paper_files/paper/2024/hash/0e5b96f97c1813bb75f6c28532c2ecc7-Abstract-Conference.html> | Generates parametric CAD operation sequences from multi-level natural language prompts, with a prompt annotation pipeline over DeepCAD. | Shows language can help describe CAD operations, but it is about CAD geometry rather than validated mechanisms with physics. |
| Wu, Xiao, Zheng, 2021, *DeepCAD: A Deep Generative Network for Computer-Aided Design Models*, ICCV. Source: <https://arxiv.org/abs/2105.09492> | Models CAD as operation sequences and provides a large CAD construction-sequence dataset. | Supports using editable operation histories rather than meshes, but does not solve mechanism kinematics. |
| Xu et al., 2022, *SkexGen: Autoregressive Generation of CAD Construction Sequences with Disentangled Codebooks*, ICML. Source: <https://proceedings.mlr.press/v162/xu22k.html> | Autoregressively generates sketch-and-extrude CAD construction sequences with disentangled topology/geometry/extrusion codes. | Useful for part geometry generation, but MotionSmith still needs mechanism semantics and assembly validators. |
| Autodesk Research, 2023, *CAD-LLM: Large Language Model for CAD Generation*. Source: <https://www.research.autodesk.com/publications/ai-lab-cad-llm/> | Research on large language models for CAD generation. | Relevant to a natural-language sidecar, but not sufficient as the core mechanism solver. |
| Li et al., 2025, *CAD-Llama: Leveraging Large Language Models for Computer-Aided Design Parametric 3D Model Generation*. Source: <https://arxiv.org/html/2505.04481v2> | Uses LLMs for parametric CAD model generation. | Another reason to represent outputs as executable/parametric code, but mechanism validation must remain separate. |
| Zhan, 2026, *FllumaOne: A Code-Native Multimodal CAD Dataset with Executable Programs and Kernel-Validated Feature Histories*. Source: <https://arxiv.org/abs/2606.17696> | Introduces executable Python CAD programs with kernel-validated geometry, STEP output, descriptions, and renderings. | Very relevant to research datasets: generated mechanism parts should be executable and kernel-validated, not just rendered. |

## 5. Cable-driven and compliant/alternative actuation

| Source | Fact | MotionSmith relevance |
|---|---|---|
| Megaro et al., 2017, *Designing Cable-Driven Actuation Networks for Kinematic Chains and Trees*, ACM TOG/SIGGRAPH. Source: CDFG project page: <https://cdfg.mit.edu/publications/designing-cable-driven-actuation-networks-kinematic-chains-and-trees> | Optimizes cable routing for hierarchical rigid-link assemblies with hinge joints and user-specified target poses/keyframes; places torsional springs and computes cable networks to reproduce poses. | Provides a concrete research path for character-part motion when linkages/gears are too bulky. It is not a first classroom-kit feature unless cable routing, tension, and assembly are made novice-safe. |

## 6. Build123d / CAD-as-code infrastructure

| Source | Fact | MotionSmith relevance |
|---|---|---|
| build123d documentation. Source: <https://build123d.readthedocs.io/> | build123d is a Python parametric BREP CAD framework built on Open Cascade for 2D/3D CAD and manufacturing outputs. | Good research/teacher-pack generator for exact plates, spacers, links, gears, STEP/STL/SVG/DXF artifacts. |
| build123d import/export docs. Source: <https://build123d.readthedocs.io/en/latest/import_export.html> | Provides 2D exporters such as DXF and SVG. | Can generate blueprint/cut files from the same mechanism DSL used for simulation. |
| OpenCascade build123d project page. Source: <https://dev.opencascade.org/project/build123d> | Describes build123d as a Python BREP modeling framework on Open Cascade, suitable for 3D printing, CNC, laser cutting, and CAD export. | Supports the idea of kernel-validated geometry for research artifacts, but browser production should not depend on server-side Python. |

## 7. Synthesis: what exists and what appears open

### Supported by sources

- Motion/path-to-mechanism synthesis exists in graphics/mechanical-design research, especially for mechanical characters, automata, linkage paths, wind-up toys, and cable actuation.
- Recent AI work is moving from retrieval and VAEs toward DSL/sequence generation for target-curve-to-mechanism design.
- Text-to-CAD exists, but it primarily generates CAD operations/geometry, not physically validated mechanisms with constraints, joints, z-stacks, and classroom assembly steps.

### Inference

No reviewed source establishes a complete text-to-fabricatable-character-automaton pipeline that combines all of the following: novice free-path input, character IK binding, validated 15x15 board fabrication, 2.5D/3D physics preview, blueprint output, and step-by-step assembly guide in a browser-local product. That combined gap is a plausible MotionSmith research contribution, but it must be framed as integration of known ingredients, not as a claim that no adjacent system exists.

### Recommendation

Prioritize **motion-conditioned DSL synthesis** over open-ended text generation:

1. target curve/keyframes as primary input;
2. short text only for intent/template priors;
3. retrieve/generate candidate typed mechanisms;
4. snap to physical kit;
5. verify through deterministic kinematics, collision, z-clearance, force/velocity/friction simulation, and export checks;
6. expose as tinkerable editable candidates, never as opaque AI output.


## 8. Additional AI/CAD sources to track

These sources extend the core map and should be validated again before any paper submission or implementation dependency decision.

| Source | Fact | MotionSmith relevance |
|---|---|---|
| Pan et al., 2021, *Joint Search of Optimal Topology and Trajectory for Planar Linkages*. Source: <https://arxiv.org/abs/2109.03392> | Jointly searches planar linkage topology and trajectory. | Optimization baseline between hand templates and learned generation. |
| Lee, Kim, Kang, 2024, *Deep Generative Model-based Synthesis of Four-bar Linkage Mechanisms with Target Conditions*. Source: <https://arxiv.org/abs/2402.14882> | Conditional generative four-bar synthesis with target kinematic/quasi-static requirements. | Useful baseline for constrained four-bar candidate generation. |
| Fogelson, Tucker, Cagan, 2023, *GCP-HOLO: Generating High-Order Linkage Graphs for Path Synthesis*. Source: <https://www.cmu.edu/me/idig/projects/Fogelson-linkage_synthesis.html> | Uses graph-policy ideas for high-order linkage graph path synthesis. | Relevant when moving beyond fixed 4bar/6bar templates. |
| Deshpande and Purwar, 2019/2021, generative and image-based path synthesis of mechanisms. Sources: <https://asmedigitalcollection.asme.org/mechanicaldesign/article/141/12/121402/956257/Computational-Creativity-Via-Assisted-Variational> and <https://researchconnect.suny.edu/en/publications/an-image-based-approach-to-variational-path-synthesis-of-linkages-2/> | Uses deep generative/image-based methods for linkage synthesis. | Relevant to rough drawn path inputs; outputs still need typed/fabrication validation. |
| Nurizada and Purwar, 2023, *Transforming Hand-Drawn Sketches of Linkage Mechanisms Into Their Digital Representation*. Source: <https://asmedigitalcollection.asme.org/computingengineering/article/24/1/011010/1170006/Transforming-Hand-Drawn-Sketches-of-Linkage> | Recognizes hand-drawn linkage sketches using neural methods plus topological knowledge. | Separate future sketch-recognition track; not equivalent to motion synthesis. |
| Islam, He, Ciocarlie, 2024, *Task-Based Design and Policy Co-Optimization for Tendon-driven Underactuated Kinematic Chains*. Source: <https://arxiv.org/abs/2405.14566> | Co-optimizes tendon-driven morphology and control policy. | Modern tendon/cable reference for non-linkage actuation. |
| Zharkov et al., 2024, *Automatic Synthesis of Tendon-Driven Grippers*. Source: <https://arxiv.org/abs/2410.07865> | Automatically synthesizes tendon-driven gripper morphology. | Supports cable/tendon branch but demands separate novice assembly validators. |
| CAD-Coder, Text-to-CadQuery, CADDesigner, and CAD program augmentation papers. Sources: <https://arxiv.org/abs/2505.19713>, <https://arxiv.org/abs/2505.06507>, <https://arxiv.org/abs/2508.01031>, <https://arxiv.org/abs/2603.06894> | Recent text/agentic CAD-as-code systems generate CadQuery/CAD programs or use geometric feedback. | Useful for build123d/CAD sidecars; not evidence of mechanism validity. |
