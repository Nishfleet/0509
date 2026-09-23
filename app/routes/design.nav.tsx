import { Nav } from "../components/nav";

export default function Page() {
  return (
    <div className="min-[860px]:flex">
      <Nav />
      <main className="min-w-0 flex-1 p-4 pb-[92px] min-[860px]:pb-4">
        <h1>Nav</h1>
      </main>
    </div>
  );
}
