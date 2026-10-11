import { SampleRequestsList } from '@/components/SampleRequestsList';

/** The inquiry's sample requests. New requests come from the Products tab (tick products, Request samples). */
export function InquirySamplesTab({ inquiryId, refreshKey }: { inquiryId: string; refreshKey: number }) {
  return <SampleRequestsList inquiryId={inquiryId} refreshKey={refreshKey} />;
}
