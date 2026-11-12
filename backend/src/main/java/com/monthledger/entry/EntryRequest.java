package com.monthledger.entry;

import java.math.BigDecimal;
import java.time.LocalDate;

public record EntryRequest(LocalDate date, EntryKind kind, BigDecimal amount, Long categoryId, PaymentMode paymentMode, String note) {}
