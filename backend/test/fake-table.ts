import { mock } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

/**
 * In-memory stand-in for the ssi-events table. Implements only the expressions the backend uses,
 * and applies TransactWrite all-or-nothing. Real concurrency is tested against DynamoDB itself.
 */
export type Item = Record<string, any>;
export const table = new Map<string, Item>();
const k = (i: Item) => `${i.PK}|${i.SK}`;

class ConditionalCheckFailed extends Error { name = 'ConditionalCheckFailedException'; }

function check(item: Item | undefined, condition: string | undefined, values: Item = {}, names: Item = {}): boolean {
  if (!condition) return true;
  const attr = (n: string) => item?.[names[n] ?? n];
  return condition.split(' AND ').every((part) => {
    part = part.trim();
    let m: RegExpMatchArray | null;
    if (part === 'attribute_not_exists(PK)') return !item;
    if (part === 'attribute_exists(PK)') return !!item;
    if (part === 'bookedCount < #cap') return !!item && item.bookedCount < item[names['#cap']];
    if ((m = part.match(/^(\S+) > (:\w+)$/))) return !!item && attr(m[1]!) > values[m[2]!];
    if ((m = part.match(/^(\S+) <> (:\w+)$/))) return !!item && attr(m[1]!) !== values[m[2]!];
    if ((m = part.match(/^(\S+) = (:\w+)$/))) return !!item && attr(m[1]!) === values[m[2]!];
    throw new Error(`fake table: unsupported condition "${part}"`);
  });
}

function update(item: Item, expression: string, values: Item, names: Item = {}): Item {
  const out = { ...item };
  const name = (n: string) => names[n] ?? n;
  const [verb, rest] = [expression.slice(0, 3), expression.slice(4)];
  for (const clause of rest.split(/,\s*/)) {
    let m: RegExpMatchArray | null;
    if (verb === 'ADD' && (m = clause.match(/^(\S+) (:\w+)$/))) out[name(m[1]!)] = (out[name(m[1]!)] ?? 0) + values[m[2]!];
    else if ((m = clause.match(/^(\S+) = (\S+) ([+-]) (:\w+)$/))) out[name(m[1]!)] = out[name(m[2]!)] + (m[3] === '+' ? 1 : -1) * values[m[4]!];
    else if ((m = clause.match(/^(\S+) = (:\w+)$/))) out[name(m[1]!)] = values[m[2]!];
    else throw new Error(`fake table: unsupported update "${clause}"`);
  }
  return out;
}

function query(input: Item): Item[] {
  const v = input.ExpressionAttributeValues;
  const pkAttr = input.IndexName ? `${input.IndexName}PK` : 'PK';
  return [...table.values()].filter((i) => {
    const wanted = v[':pk'] ?? v[':p'];
    if (wanted === undefined || i[pkAttr] !== wanted) return false;
    const begins = input.KeyConditionExpression.match(/begins_with\(SK, (:\w+)\)/);
    if (begins) return String(i.SK).startsWith(v[begins[1]]);
    if (v[':since']) return i.SK >= v[':since'];
    return true;
  });
}

export async function installFakeTable(db: { send: (...args: any[]) => any }) {
  const { TransactionCanceledException } = await import('@aws-sdk/client-dynamodb');
  table.clear();
  mock.method(db, 'send', async (command: any) => {
    const input = command.input;
    switch (command.constructor.name) {
      case 'GetCommand': return { Item: table.get(k(input.Key)) };
      case 'PutCommand':
        if (!check(table.get(k(input.Item)), input.ConditionExpression)) throw new ConditionalCheckFailed('condition');
        table.set(k(input.Item), input.Item); return {};
      case 'DeleteCommand': table.delete(k(input.Key)); return {};
      case 'UpdateCommand': {
        const item = table.get(k(input.Key)) ?? { ...input.Key };
        table.set(k(input.Key), update(item, input.UpdateExpression, input.ExpressionAttributeValues ?? {}, input.ExpressionAttributeNames));
        return {};
      }
      case 'BatchWriteCommand':
        for (const r of Object.values(input.RequestItems)[0] as Item[]) table.set(k(r.PutRequest.Item), r.PutRequest.Item);
        return {};
      case 'QueryCommand': {
        const rows = query(input);
        return input.Select === 'COUNT' ? { Count: rows.length } : { Items: rows };
      }
      case 'TransactWriteCommand': {
        const ops = input.TransactItems as Item[];
        const reasons = ops.map((op) => {
          const [kind, body] = Object.entries(op)[0] as [string, Item];
          const key = k(kind === 'Put' ? body.Item : body.Key);
          return check(table.get(key), body.ConditionExpression, body.ExpressionAttributeValues, body.ExpressionAttributeNames)
            ? { Code: 'None' } : { Code: 'ConditionalCheckFailed' };
        });
        if (reasons.some((r) => r.Code !== 'None')) {
          throw new TransactionCanceledException({ message: 'cancelled', $metadata: {}, CancellationReasons: reasons });
        }
        for (const op of ops) {
          const [kind, body] = Object.entries(op)[0] as [string, Item];
          if (kind === 'Put') table.set(k(body.Item), body.Item);
          else if (kind === 'Delete') table.delete(k(body.Key));
          else if (kind === 'Update') {
            const item = table.get(k(body.Key)) ?? { ...body.Key };
            table.set(k(body.Key), update(item, body.UpdateExpression, body.ExpressionAttributeValues ?? {}, body.ExpressionAttributeNames));
          }
        }
        return {};
      }
      default: throw new Error(`fake table: unexpected ${command.constructor.name}`);
    }
  });
}

type Handler = (event: APIGatewayProxyEventV2) => Promise<any>;

/** Builds a function-URL style request and returns the parsed response. */
export function client(handler: Handler) {
  return async (method: string, path: string, opts: { body?: unknown; raw?: Buffer; contentType?: string; cookies?: string[]; headers?: Record<string, string> } = {}) => {
    const [rawPath, search = ''] = path.split('?');
    const body = opts.raw ?? (opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body)));
    const res = await handler({
      rawPath, requestContext: { http: { method } },
      queryStringParameters: Object.fromEntries(new URLSearchParams(search)),
      headers: { 'content-type': opts.contentType ?? 'application/json', ...opts.headers },
      cookies: opts.cookies, body: body?.toString('base64'), isBase64Encoded: body !== undefined,
    } as unknown as APIGatewayProxyEventV2);
    const data = res.body && !res.isBase64Encoded ? JSON.parse(res.body) : undefined;
    return { status: res.statusCode as number, data, cookies: (res.cookies ?? []) as string[], raw: res };
  };
}

/** `name=value` pairs from Set-Cookie strings, for sending back on the next request. */
export const jar = (setCookies: string[]) => setCookies.map((c) => c.split(';')[0]!).filter((c) => !c.endsWith('='));
