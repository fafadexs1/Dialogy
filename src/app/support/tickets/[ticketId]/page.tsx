
import TicketDetailClient from './ticket-client';

export default async function TicketPage(props: { params: Promise<{ ticketId: string }> }) {
    const params = await props.params;
    return <TicketDetailClient ticketId={params.ticketId} />;
}
