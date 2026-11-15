package com.monthledger.entry;

import com.monthledger.category.Category;
import com.monthledger.goal.Goal;
import com.monthledger.recurring.Recurring;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * CSV for backups. Categories, goals and monthly items are written by name so the file reads well
 * in Excel and can be loaded into another copy of the app. Must stay in step with csv.ts.
 */
final class EntryCsv {
    static final String HEADER = "Date,Kind,Category,Bucket,Amount,Payment,Note,Goal,Monthly item";
    /** Excel opens UTF-8 (₹, emoji) correctly only with a byte-order mark. */
    static final String BOM = "﻿";

    private EntryCsv() {}

    static String write(List<Entry> entries, Map<Long, Category> categories, Map<Long, Goal> goals, Map<Long, Recurring> recurring) {
        StringBuilder out = new StringBuilder(BOM).append(HEADER).append("\r\n");
        for (Entry e : entries) {
            Category c = categories.get(e.getCategoryId());
            Goal g = e.getGoalId() == null ? null : goals.get(e.getGoalId());
            Recurring r = e.getRecurringId() == null ? null : recurring.get(e.getRecurringId());
            out.append(e.getDate()).append(',')
               .append(e.getKind()).append(',')
               .append(text(c == null ? "" : c.getName())).append(',')
               .append(c == null ? "" : c.getBucket()).append(',')
               .append(plain(e.getAmount())).append(',')
               .append(e.getPaymentMode() == null ? "" : e.getPaymentMode()).append(',')
               .append(text(e.getNote())).append(',')
               .append(text(g == null ? null : g.getName())).append(',')
               .append(text(r == null ? null : r.getName())).append("\r\n");
        }
        return out.toString();
    }

    /** 40.00 → 40, 850.50 → 850.5: what a person would type. */
    static String plain(BigDecimal amount) {
        BigDecimal stripped = amount.stripTrailingZeros();
        return (stripped.scale() < 0 ? stripped.setScale(0) : stripped).toPlainString();
    }

    /**
     * Quoted, with "" for quotes. A leading = + - @ gets a ' in front so a spreadsheet shows the text
     * instead of running it as a formula; csv.ts strips that ' again on import.
     */
    static String text(String value) {
        if (value == null || value.isEmpty()) return "";
        String safe = "=+-@".indexOf(value.charAt(0)) >= 0 ? "'" + value : value;
        return '"' + safe.replace("\"", "\"\"") + '"';
    }
}
