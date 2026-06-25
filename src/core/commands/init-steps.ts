import { confirm, input, select } from "@inquirer/prompts";
import type { Domain, InitStep, ResolveContext } from "../types/public.js";
import type { PluginRegistry } from "../plugin-loader.js";
import { orderedDomains } from "../plugin-loader.js";

export interface RunStepsOptions {
  yes: boolean;
  dryRun: boolean;
}

/**
 * Run every step in a single domain's `initSteps` array. Each step prompts the
 * user (or uses its `default` under `-y`) then invokes the callback. A throw in
 * one step is logged and swallowed so subsequent steps still run.
 */
export async function runDomainInitSteps(
  domain: Domain,
  ctx: ResolveContext,
  opts: RunStepsOptions,
): Promise<void> {
  const steps = domain.initSteps;
  if (!steps || steps.length === 0) return;

  for (const step of steps) {
    try {
      if (step.when && !(await step.when(ctx))) {
        ctx.logger.debug(`skipping ${domain.id}.${step.id} (when predicate false)`);
        continue;
      }
      const value = await resolveStepValue(step, opts, ctx);
      if (opts.dryRun) {
        ctx.logger.info(`would: ${domain.id}.${step.id} = ${formatValue(value)}`);
        continue;
      }
      await invokeCallback(step, value, ctx);
    } catch (err) {
      ctx.logger.error(`${domain.id}.${step.id} failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Run every domain's initSteps in priority order. `onlyIds`, when provided,
 * filters to domains whose id matches. Unknown ids are logged and ignored.
 */
export async function runAllDomainInitSteps(
  registry: PluginRegistry,
  ctx: ResolveContext,
  opts: RunStepsOptions,
  onlyIds?: readonly string[],
): Promise<void> {
  let filterSet: Set<string> | undefined;
  if (onlyIds && onlyIds.length > 0) {
    filterSet = new Set(onlyIds);
    const known = new Set(registry.domains.keys());
    for (const id of filterSet) {
      if (!known.has(id)) ctx.logger.warn(`--only: no domain with id "${id}"`);
    }
  }

  for (const dom of orderedDomains(registry)) {
    if (filterSet && !filterSet.has(dom.domain.id)) continue;
    await runDomainInitSteps(dom.domain, ctx, opts);
  }
}

async function resolveStepValue(
  step: InitStep,
  opts: RunStepsOptions,
  ctx: ResolveContext,
): Promise<unknown> {
  if (opts.yes || opts.dryRun) return defaultFor(step, ctx);

  switch (step.type) {
    case "text": {
      const def = await resolveDefault<string>(step.default, ctx);
      return await input({ message: step.message, default: def, validate: step.validate });
    }
    case "boolean": {
      const def = (await resolveDefault<boolean>(step.default, ctx)) ?? false;
      return await confirm({ message: step.message, default: def });
    }
    case "select": {
      const def = await resolveDefault<string>(step.default, ctx);
      return await select<string>({ message: step.message, choices: step.choices, default: def });
    }
  }
}

async function defaultFor(step: InitStep, ctx: ResolveContext): Promise<unknown> {
  switch (step.type) {
    case "text":
      return (await resolveDefault<string>(step.default, ctx)) ?? "";
    case "boolean":
      return (await resolveDefault<boolean>(step.default, ctx)) ?? false;
    case "select":
      return (await resolveDefault<string>(step.default, ctx)) ?? step.choices[0]?.value;
  }
}

async function resolveDefault<T>(
  def: T | ((ctx: ResolveContext) => T | Promise<T>) | undefined,
  ctx: ResolveContext,
): Promise<T | undefined> {
  if (typeof def === "function") return await (def as (c: ResolveContext) => T | Promise<T>)(ctx);
  return def;
}

async function invokeCallback(step: InitStep, value: unknown, ctx: ResolveContext): Promise<void> {
  switch (step.type) {
    case "text":
      await step.callback(value as string, ctx);
      return;
    case "boolean":
      await step.callback(value as boolean, ctx);
      return;
    case "select":
      await step.callback(value as string, ctx);
      return;
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}
