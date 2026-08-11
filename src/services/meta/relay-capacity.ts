export class RelayCapacity {
  private active = 0;
  private claiming = false;

  constructor(private readonly concurrency: number) {}

  beginClaim(): number {
    if (this.claiming || this.active >= this.concurrency) return 0;
    this.claiming = true;
    return this.concurrency - this.active;
  }

  finishClaim(): void {
    this.claiming = false;
  }

  startDelivery(): void {
    this.active += 1;
  }

  finishDelivery(): void {
    this.active = Math.max(0, this.active - 1);
  }

  get activeCount(): number {
    return this.active;
  }
}
