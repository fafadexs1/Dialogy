import { Redirect } from "expo-router";
import { useInbox } from "@/state/InboxContext";

export default function IndexRoute() {
  const { user } = useInbox();
  return <Redirect href={user ? "/inbox" : "/login"} />;
}
