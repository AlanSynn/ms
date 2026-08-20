import * as THREE from "three";

type PoolSlot = {
  topologyKey: string;
  object: THREE.Object3D;
};

export type FoundryPooledObject<T extends THREE.Object3D> = {
  object: T;
  created: boolean;
};

/**
 * Reuses semantic draw slots in call order. Foundry recipes emit the same
 * primitive order while a mechanism plays, so transforms and visibility can
 * change without allocating another Object3D graph.
 */
export class FoundryThreeObjectPool {
  private readonly slots = new Map<string, PoolSlot[]>();
  private readonly cursors = new Map<string, number>();
  private revision = 0;

  constructor(
    readonly root: THREE.Group,
    private readonly disposeObject: (object: THREE.Object3D) => void,
    private readonly maxRetainedEntries = Number.POSITIVE_INFINITY,
  ) {}

  beginFrame() {
    this.cursors.clear();
  }

  acquire<T extends THREE.Object3D>(
    kind: string,
    topologyKey: string,
    create: () => T,
  ): FoundryPooledObject<T> {
    const index = this.cursors.get(kind) ?? 0;
    this.cursors.set(kind, index + 1);
    const bucket = this.slots.get(kind) ?? [];
    if (!this.slots.has(kind)) this.slots.set(kind, bucket);
    const existing = bucket[index];
    if (existing?.topologyKey === topologyKey) {
      existing.object.visible = true;
      return { object: existing.object as T, created: false };
    }

    if (existing) {
      existing.object.removeFromParent();
      this.disposeObject(existing.object);
    }
    const object = create();
    object.visible = true;
    this.root.add(object);
    bucket[index] = { topologyKey, object };
    this.revision += 1;
    return { object, created: true };
  }

  endFrame() {
    this.slots.forEach((bucket, kind) => {
      const used = this.cursors.get(kind) ?? 0;
      for (let index = used; index < bucket.length; index += 1) {
        bucket[index].object.visible = false;
      }
    });
    this.trimUnusedEntries();
  }

  private trimUnusedEntries() {
    let retained = this.retainedObjectCount;
    if (retained <= this.maxRetainedEntries) return;
    const entries = [...this.slots.entries()].reverse();
    entries.forEach(([kind, bucket]) => {
      const used = this.cursors.get(kind) ?? 0;
      while (
        retained > this.maxRetainedEntries &&
        bucket.length > used
      ) {
        const slot = bucket.pop();
        if (!slot) break;
        slot.object.removeFromParent();
        this.disposeObject(slot.object);
        retained -= 1;
        this.revision += 1;
      }
      if (!bucket.length) this.slots.delete(kind);
    });
  }

  get topologyRevision() {
    return this.revision;
  }

  get retainedObjectCount() {
    let count = 0;
    this.slots.forEach((bucket) => {
      count += bucket.length;
    });
    return count;
  }
}
