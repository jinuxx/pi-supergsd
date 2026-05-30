import { it } from 'node:test';

import { TestHarness } from './test-harness.js';

export function node(name: string, fn: NodeFn) {
  return new PathBuilder(name, fn);
}

export interface TestNode {
  children(...children: TestNode[]): TestNode;
  run(): void;
}

type NodeFn = (h: TestHarness) => Promise<void> | void;

class PathBuilder implements TestNode {
  constructor(
    private readonly name: string,
    private readonly fn?: NodeFn,
  ) {}

  private readonly childPaths: PathBuilder[] = [];
  private registered = false;

  children(...children: TestNode[]): TestNode {
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

function asPathBuilder(node: TestNode): PathBuilder {
  if (!(node instanceof PathBuilder)) {
    throw new TypeError('path().children() only accepts nodes returned by path()');
  }

  return node;
}