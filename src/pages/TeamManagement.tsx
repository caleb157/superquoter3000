import { AppLayout } from '@/components/AppLayout';
import TeamManagementContent from '@/components/TeamManagementContent';

export default function TeamManagement() {
  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <TeamManagementContent />
      </div>
    </AppLayout>
  );
}
