#!/usr/bin/env node
/**
 * Delete every Xcode Cloud workflow for the Companion iOS app.
 *
 * GitHub Actions never starts TestFlight on a PR — `mobile-release.yml` is
 * workflow_dispatch + `ios-v*` tags. The checks on PRs (`App | BuildTestFlight`)
 * come from Xcode Cloud, whose start conditions live in App Store Connect, not
 * in this repo. This script is the repo-side way to remove those workflows via
 * the App Store Connect API so they stop firing on every GitHub PR.
 *
 *   gh workflow run xcode-cloud-manual-only.yml --ref main
 *
 * Requires APPSTORE_ISSUER_ID, APPSTORE_KEY_ID, APPSTORE_PRIVATE_KEY.
 *
 * Deleting a workflow also deletes its build history. That is the point: we do
 * not want a second TestFlight path. GitHub Actions `mobile-release.yml` is the
 * remaining lane.
 */

import crypto from 'node:crypto';

const API = 'https://api.appstoreconnect.apple.com';
const BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'com.companionintelligence.app';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

function appleJwt() {
  const issuer = requiredEnv('APPSTORE_ISSUER_ID');
  const keyId = requiredEnv('APPSTORE_KEY_ID');
  const pem = requiredEnv('APPSTORE_PRIVATE_KEY').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      iat: now,
      exp: now + 15 * 60,
      aud: 'appstoreconnect-v1',
    }),
  ).toString('base64url');
  const key = crypto.createPrivateKey(pem);
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });

  return `${header}.${payload}.${signature.toString('base64url')}`;
}

async function asc(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${text}`);
  }

  return json;
}

async function main() {
  const token = appleJwt();
  const apps = await asc(token, 'GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
  const app = apps.data?.[0];

  if (!app) {
    throw new Error(`No App Store Connect app for bundle id ${BUNDLE_ID}`);
  }

  const product = await asc(token, 'GET', `/v1/apps/${app.id}/ciProduct`);
  const productId = product.data?.id;

  if (!productId) {
    console.log(`App ${BUNDLE_ID} (${app.id}) has no Xcode Cloud product — nothing to delete.`);

    return;
  }

  const workflows = await asc(token, 'GET', `/v1/ciProducts/${productId}/workflows?limit=50`);
  const list = workflows.data ?? [];

  if (list.length === 0) {
    console.log(`No Xcode Cloud workflows on product ${productId}.`);

    return;
  }

  for (const workflow of list) {
    const name = workflow.attributes?.name ?? workflow.id;
    console.log(`▸ deleting ${name} (${workflow.id})`);
    await asc(token, 'DELETE', `/v1/ciWorkflows/${workflow.id}`);
    console.log(`  deleted. GitHub PRs will no longer get App | BuildTestFlight checks from this workflow.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
