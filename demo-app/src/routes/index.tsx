import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Member Search — LegacyBank Admin" },
      {
        name: "description",
        content:
          "LegacyBank Admin back-office console: look up member records and account balances by Member ID.",
      },
      { property: "og:title", content: "Member Search — LegacyBank Admin" },
      {
        property: "og:description",
        content:
          "Internal back-office console for looking up member records and account balances.",
      },
    ],
  }),
  component: Index,
});

type Account = { type: string; balance: number };
type Member = {
  id: string;
  name: string;
  status: string;
  accounts: Account[];
};

const MEMBERS: Member[] = [
  {
    id: "12345",
    name: "John Smith",
    status: "Active",
    accounts: [
      { type: "Checking", balance: 2430.19 },
      { type: "Savings", balance: 7845.44 },
    ],
  },
  {
    id: "67890",
    name: "Sarah Johnson",
    status: "Active",
    accounts: [
      { type: "Checking", balance: 1925.1 },
      { type: "Savings", balance: 12412.73 },
    ],
  },
];

const currency = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

function Index() {
  const [memberId, setMemberId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Member | null>(null);
  const [notFoundId, setNotFoundId] = useState<string | null>(null);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const query = memberId.trim();
    setLoading(true);
    setResult(null);
    setNotFoundId(null);

    window.setTimeout(() => {
      const found = MEMBERS.find((m) => m.id === query);
      if (found) {
        setResult(found);
      } else {
        setNotFoundId(query);
      }
      setLoading(false);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-4xl items-baseline justify-between px-4 py-2">
          <span className="text-sm font-bold tracking-wide">
            LegacyBank Admin
          </span>
          <span className="text-xs">Back Office Console v4.2.1</span>
        </div>
      </header>

      <nav className="border-b border-border bg-secondary">
        <div className="mx-auto max-w-4xl px-4 py-1 text-xs text-secondary-foreground">
          Home &gt; Member Services &gt; Member Search
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="mb-4 border-b border-border pb-2 text-xl font-bold">
          Member Search
        </h1>

        <section className="mb-6 border border-border bg-card p-4">
          <form onSubmit={handleSearch}>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="member-id"
                  className="mb-1 block text-xs font-bold uppercase text-muted-foreground"
                >
                  Member ID
                </label>
                <input
                  id="member-id"
                  name="memberId"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  className="w-56 border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="border border-border bg-secondary px-4 py-1 text-sm font-bold text-secondary-foreground hover:bg-accent disabled:opacity-60"
              >
                Search
              </button>
            </div>
          </form>
        </section>

        {loading && (
          <p className="border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Searching member records, please wait...
          </p>
        )}

        {!loading && notFoundId !== null && (
          <div className="border border-destructive bg-card p-4">
            <h2 className="text-base font-bold text-destructive">
              Member not found
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              No member record exists for Member ID "{notFoundId}". Verify the
              ID and try again.
            </p>
          </div>
        )}

        {!loading && result && (
          <section className="border border-border bg-card">
            <h2 className="border-b border-border bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground">
              Member Details
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-border">
                  <th
                    scope="row"
                    className="w-48 bg-muted px-3 py-2 text-left font-bold"
                  >
                    Member ID
                  </th>
                  <td className="px-3 py-2">{result.id}</td>
                </tr>
                <tr className="border-b border-border">
                  <th
                    scope="row"
                    className="bg-muted px-3 py-2 text-left font-bold"
                  >
                    Member Name
                  </th>
                  <td className="px-3 py-2">{result.name}</td>
                </tr>
                <tr>
                  <th
                    scope="row"
                    className="bg-muted px-3 py-2 text-left font-bold"
                  >
                    Status
                  </th>
                  <td className="px-3 py-2">{result.status}</td>
                </tr>
              </tbody>
            </table>

            <h3 className="border-y border-border bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
              Accounts
            </h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted">
                  <th
                    scope="col"
                    className="border-b border-border px-3 py-2 text-left font-bold"
                  >
                    Account Type
                  </th>
                  <th
                    scope="col"
                    className="border-b border-border px-3 py-2 text-right font-bold"
                  >
                    Current Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.accounts.map((account) => (
                  <tr key={account.type} className="border-b border-border">
                    <td className="px-3 py-2">{account.type}</td>
                    <td className="px-3 py-2 text-right">
                      {currency(account.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>

      <footer className="mx-auto max-w-4xl px-4 py-6 text-xs text-muted-foreground">
        LegacyBank Admin — Internal Use Only. All data shown is simulated test
        data.
      </footer>
    </div>
  );
}
