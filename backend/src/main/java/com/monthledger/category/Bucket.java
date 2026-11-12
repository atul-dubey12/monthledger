package com.monthledger.category;

/** Every category sits in exactly one bucket, so an entry's bucket is never chosen by hand. */
public enum Bucket { INCOME, NEED, WANT, SAVING }
