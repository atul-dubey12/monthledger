package com.monthledger.entry;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
@Table(name = "entries")
public class Entry {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "entry_date", nullable = false) private LocalDate date;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private EntryKind kind;
    @Column(nullable = false, precision = 12, scale = 2) private BigDecimal amount;
    @Column(name = "category_id", nullable = false) private Long categoryId;
    @Enumerated(EnumType.STRING) @Column(name = "payment_mode", length = 10) private PaymentMode paymentMode;
    @Column(length = 180) private String note;
    @Column(name = "goal_id") private Long goalId;

    public Long getId() { return id; }
    public LocalDate getDate() { return date; }
    public void setDate(LocalDate date) { this.date = date; }
    public EntryKind getKind() { return kind; }
    public void setKind(EntryKind kind) { this.kind = kind; }
    public BigDecimal getAmount() { return amount; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }
    public Long getCategoryId() { return categoryId; }
    public void setCategoryId(Long categoryId) { this.categoryId = categoryId; }
    public PaymentMode getPaymentMode() { return paymentMode; }
    public void setPaymentMode(PaymentMode paymentMode) { this.paymentMode = paymentMode; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
    public Long getGoalId() { return goalId; }
    public void setGoalId(Long goalId) { this.goalId = goalId; }
}
