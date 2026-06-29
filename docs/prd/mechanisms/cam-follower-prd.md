# MotionSmith cam follower PRD

## Scope
Verified Foundry mechanism with user-editable cam profile. Source pattern: CamFollowerJS angle/lift samples and polar conversion.

References:
- https://github.com/jumpjack/CamFollowerJS

## Topology contract

```text
C fixed cam axle
r(theta) editable cam radius profile
F follower contact/slider point
track axis fixed by groundAngle
```

## Editable cam profile

- Store raw `camProfileSamples: number[]` on mechanism.
- Samples are cyclic, angle-indexed, normalized radius/lift scale values.
- Default samples reproduce current eccentric/lobed profile.
- UI edits samples directly by dragging curve points; kinematics and 3D mesh read the same samples.
- Fabrication may later snap to named presets, but preview must honor edited samples.

## Physics invariants

- Cam radius at phase uses cyclic linear interpolation of `camProfileSamples`.
- Follower rise is derived from `profile(theta) - profile(0)`, scaled to `rockerLength`.
- Force/velocity arrows originate at follower output, not arbitrary screen point.
- User-edited duplicate/invalid samples are sanitized to finite positive values.

## Fabrication contract

- Cam mesh uses the same sampled profile as kinematics.
- Axle hole follows centralized `FABRICATION_HOLE_RADIUS_MM`.
- Follower guide and block use S10 clearance stacks.

## Tests

- Contract test verifies custom profile changes follower rise and rendered radius source.
- Browser test verifies cam profile editor exists for cam Foundry and dragging updates stored data.
