import { it } from 'node:test';

import { TestHarness } from './test-harness.js';

export const path: PathFn = (name, fn) => new PathBuilder(name, fn);

export type PathFn = (name: string, fn?: PathStep) => PathNode;

export interface PathNode {
  children(...children: PathNode[]): PathNode;
  run(): void;
}

type PathStep = (h: TestHarness) => Promise<void> | void;

class PathBuilder implements PathNode {
  constructor(
    private readonly name: string,
    private readonly fn?: PathStep,
  ) {}

  private readonly childPaths: PathBuilder[] = [];
  private registered = false;

  children(...children: PathNode[]): PathNode {
    this.childPaths.push(...children.map(asPathBuilder));
    return this;
  }

  run(): void {
    this.register([]);
  }

  private register(ancestors: PathBuilder[]): void {
    if (this.registered) {
      throw new Error(`Path "${this.name}" has already been registered`);
    }

    this.registered = true;

    const chain = [...ancestors, this];
    const name = chain.map(node => node.name).join(' → ');

    it(name, async () => {
      const h = new TestHarness();

      for (const node of chain) {
        await node.fn?.(h);
      }
    });

    for (const child of this.childPaths) {
      child.register(chain);
    }
  }
}

function asPathBuilder(node: PathNode): PathBuilder {
  if (!(node instanceof PathBuilder)) {
    throw new TypeError('path().children() only accepts nodes returned by path()');
  }

  return node;
}