import net from "node:net";

/**
 * TCP-прокси для тестов отказов. Режим «чёрная дыра» имитирует сетевой разрыв без RST
 * (падение узла, failover с переездом, разрыв между зонами): соединения остаются открытыми,
 * но данные перестают ходить. После «лечения» новые соединения работают, а старые остаются мёртвыми.
 */
export interface BlackholeProxy {
  url(base: string): string;
  readonly port: number;
  blackhole(): void;
  heal(): void;
  close(): Promise<void>;
}

interface Conn {
  client: net.Socket;
  upstream: net.Socket;
  dead: boolean;
}

export async function startBlackholeProxy(target: { host: string; port: number }): Promise<BlackholeProxy> {
  let holed = false;
  const conns = new Set<Conn>();
  const server = net.createServer((client) => {
    const upstream = net.connect(target.port, target.host);
    const conn: Conn = { client, upstream, dead: holed };
    conns.add(conn);
    client.on("data", (d) => {
      if (!conn.dead) upstream.write(d);
    });
    upstream.on("data", (d) => {
      if (!conn.dead) client.write(d);
    });
    const drop = () => {
      conns.delete(conn);
      client.destroy();
      upstream.destroy();
    };
    for (const s of [client, upstream]) {
      s.on("error", drop);
      s.on("close", drop);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    url(base: string) {
      const u = new URL(base);
      u.hostname = "127.0.0.1";
      u.port = String(port);
      return u.toString();
    },
    blackhole() {
      holed = true;
      for (const c of conns) c.dead = true;
    },
    heal() {
      holed = false; // уже «мёртвые» соединения остаются мёртвыми — как после разрыва без RST
    },
    async close() {
      for (const c of conns) {
        c.client.destroy();
        c.upstream.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
