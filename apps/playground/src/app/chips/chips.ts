import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgxChipComponent } from 'ngx-powerful-tree';

interface DemoChip {
  id: string;
  label: string;
  selected: boolean;
  color?: string;
}

@Component({
  selector: 'app-chips',
  standalone: true,
  imports: [NgxChipComponent],
  templateUrl: './chips.html',
  styleUrl: './chips.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChipsComponent {
  chips = signal<DemoChip[]>([
    { id: '1', label: 'Angular', selected: true },
    { id: '2', label: 'TypeScript', selected: false },
    {
      id: '3',
      label: 'Ellipsis truncate when tooo looooooong label is used here',
      selected: false,
    },
    { id: '4', label: 'Always capital and should be 38px height', selected: false },
    { id: '5', label: 'Hover and display remove', selected: true },
    { id: '6', label: 'Unactive state', selected: false },
    { id: '7', label: 'Selected / Active', selected: true },
  ]);

  lastEvent = signal<string>('');

  onSelectedChange(chipId: string, isSelected: boolean): void {
    this.chips.update((list) =>
      list.map((c) => (c.id === chipId ? { ...c, selected: isSelected } : c))
    );
    this.lastEvent.set(`Chip "${chipId}" → selected: ${isSelected}`);
  }

  onShare(chipId: string): void {
    this.lastEvent.set(`Share clicked on chip "${chipId}"`);
  }

  onDelete(chipId: string): void {
    this.chips.update((list) => list.filter((c) => c.id !== chipId));
    this.lastEvent.set(`Chip "${chipId}" deleted`);
  }
}
