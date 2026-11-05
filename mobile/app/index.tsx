import { Redirect } from "expo-router";
import { useInbox } from "@/state/InboxContext";

export default function IndexRoute() {
  const { isLoading, user } = useInbox();
  if (isLoading) return null;
  return <Redirect href={user ? "/inbox" : "/login"} />;
}
