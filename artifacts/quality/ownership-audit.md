# Production ownership audit

The G0 ownership table began with 70 lane/path assignments. The G1 interface freeze added three Sol-owned paths (`utils/kinematics.ts`, `utils/project.ts`, and `components/stages/path/MechanismRecommendationSheet.tsx`). G5 integration approved eleven exact cross-cutting paths for the status-store boundary, compact review surface, static boot loader, and split worker/runtime helpers, bringing the table to 84 assignments. Exact-path and ancestor/descendant comparisons find zero cross-lane overlaps.

G9 is deliberately absent: Sol may wire shared product boundaries only after G2–G8 workers are inactive and their commits have been reviewed and integrated.

G1 is frozen at `a52ef5dc5bf3f6d0dce43b525f19b7fd0e0690a4`. G2, G4, G5, and G6 are integrated; their source worktrees are no longer writable lanes. G3, G7, and G8 remain deferred to their declared waves.
