package com.monthledger.entry;

import com.monthledger.category.Bucket;
import java.util.Set;

/** What happened to the money. Each kind may only use categories from certain buckets. */
public enum EntryKind {
    INCOME(Set.of(Bucket.INCOME)),
    EXPENSE(Set.of(Bucket.NEED, Bucket.WANT)),
    /** Money put aside into a savings category. */
    SAVING(Set.of(Bucket.SAVING)),
    /** Money taken back out of savings. Counted against Saved, so the totals stay honest. */
    SAVING_WITHDRAWAL(Set.of(Bucket.SAVING));

    private final Set<Bucket> buckets;
    EntryKind(Set<Bucket> buckets) { this.buckets = buckets; }
    public boolean allows(Bucket bucket) { return buckets.contains(bucket); }
}
