import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { defineDoor } from "./types.js";

export interface DeployFile {
  rel: string;
  body: Buffer;
}

/** Pluggable deploy target (R4.4, task 8/16). */
export interface DeployTarget {
  deploy(thread: string, files: DeployFile[]): Promise<{ url: string }>;
}

/** Task 8: copy the site into a local static folder. */
export class LocalTarget implements DeployTarget {
  constructor(private readonly root: string) {}
  async deploy(thread: string, files: DeployFile[]) {
    for (const f of files) {
      const to = join(this.root, thread, f.rel);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, f.body);
    }
    return { url: pathToFileURL(join(this.root, thread, "index.html")).href };
  }
}

/** The few AWS calls we need; the real adapter is `awsClientFromSdk`, tests pass a fake. */
export interface AwsClient {
  putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  invalidate(distribution: string, paths: string[]): Promise<void>;
  distributionDomain(distribution: string): Promise<string>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain",
};

/** Task 16: S3 + CloudFront. The private bucket is served through the distribution, URL goes into EVIDENCE. */
export class S3Target implements DeployTarget {
  constructor(
    private readonly aws: AwsClient,
    private readonly bucket: string,
    private readonly distribution: string,
  ) {}
  async deploy(thread: string, files: DeployFile[]) {
    for (const f of files)
      await this.aws.putObject(
        this.bucket,
        `${thread}/${f.rel}`,
        f.body,
        TYPES[extname(f.rel)] ?? "application/octet-stream",
      );
    await this.aws.invalidate(this.distribution, [`/${thread}/*`]);
    const domain = await this.aws.distributionDomain(this.distribution);
    return { url: `https://${domain}/${thread}/index.html` };
  }
}

/**
 * Real adapter over the AWS SDK v3. Credentials come from the default chain, so AWS_PROFILE works.
 * shortcut: @aws-sdk/client-s3 and @aws-sdk/client-cloudfront are not dependencies and this adapter is
 * not unit-tested (no real AWS in CI); install them and smoke-test once before the first real deploy (task 16).
 */
export async function awsClientFromSdk(): Promise<AwsClient> {
  const load = async (name: string): Promise<Record<string, unknown>> =>
    (await import(name)) as Record<string, unknown>;
  const s3m = await load("@aws-sdk/client-s3");
  const cfm = await load("@aws-sdk/client-cloudfront");
  type Ctor = new (a: unknown) => unknown;
  type Sender = { send(c: unknown): Promise<unknown> };
  const S3 = s3m["S3Client"] as new (a: unknown) => Sender;
  const CF = cfm["CloudFrontClient"] as new (a: unknown) => Sender;
  const s3 = new S3({});
  const cf = new CF({});
  return {
    async putObject(Bucket, Key, Body, ContentType) {
      await s3.send(new (s3m["PutObjectCommand"] as Ctor)({ Bucket, Key, Body, ContentType }));
    },
    async invalidate(distribution, paths) {
      await cf.send(
        new (cfm["CreateInvalidationCommand"] as Ctor)({
          DistributionId: distribution,
          InvalidationBatch: {
            CallerReference: String(Date.now()),
            Paths: { Quantity: paths.length, Items: paths },
          },
        }),
      );
    },
    async distributionDomain(distribution) {
      const r = z
        .object({ Distribution: z.object({ DomainName: z.string() }) })
        .parse(await cf.send(new (cfm["GetDistributionCommand"] as Ctor)({ Id: distribution })));
      return r.Distribution.DomainName;
    },
  };
}

/** S3 when GRAVEYARD_DEPLOY_BUCKET and GRAVEYARD_DEPLOY_DISTRIBUTION are set, otherwise the local folder. */
export async function targetFromEnv(
  env: NodeJS.ProcessEnv,
  localRoot: string,
): Promise<DeployTarget> {
  const bucket = env["GRAVEYARD_DEPLOY_BUCKET"];
  const distribution = env["GRAVEYARD_DEPLOY_DISTRIBUTION"];
  return bucket && distribution
    ? new S3Target(await awsClientFromSdk(), bucket, distribution)
    : new LocalTarget(localRoot);
}

export function readTree(root: string): DeployFile[] {
  const out: DeployFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ rel: relative(root, p).split(sep).join("/"), body: readFileSync(p) });
    }
  };
  walk(root);
  return out;
}

/** Resolve `dir` inside `base`; undefined if it escapes (no `..` tricks). */
export function inside(base: string, dir: string): string | undefined {
  const p = resolve(base, dir);
  return p === base || p.startsWith(base + sep) ? p : undefined;
}

export function makeDeploy(
  getTarget: (localRoot: string) => Promise<DeployTarget> = (root) =>
    targetFromEnv(process.env, root),
) {
  return defineDoor({
    name: "deploy",
    lock: "deploy",
    argsSchema: z.object({ dir: z.string().default("site") }),
    async run(ctx, args) {
      const src = inside(ctx.worktree, args.dir);
      if (!src) return { exitCode: 1, log: `dir '${args.dir}' is outside the worktree\n` };
      let files: DeployFile[];
      try {
        files = readTree(src);
      } catch {
        return { exitCode: 1, log: `dir '${args.dir}' does not exist\n` };
      }
      if (!files.some((f) => f.rel === "index.html"))
        return { exitCode: 1, log: `no index.html in '${args.dir}'\n` };
      const target = await getTarget(join(ctx.svc.config.dataDir, "deploy"));
      const { url } = await target.deploy(ctx.thread_id, files);
      return { exitCode: 0, log: `deployed ${files.length} files\n${url}\n`, extra: { url, files: files.length } };
    },
  });
}

export const deploy = makeDeploy();
