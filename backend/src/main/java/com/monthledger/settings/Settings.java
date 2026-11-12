package com.monthledger.settings;

import jakarta.persistence.*;

/** One row (id = 1): the things that should be the same on every device. Theme stays per device. */
@Entity
@Table(name = "settings")
public class Settings {
    @Id private Integer id;
    @Column(nullable = false, length = 30) private String name;
    @Column(name = "needs_percent", nullable = false) private int needsPercent;
    @Column(name = "wants_percent", nullable = false) private int wantsPercent;
    @Column(name = "savings_percent", nullable = false) private int savingsPercent;
    @Column(name = "month_start_day", nullable = false) private int monthStartDay;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public int getNeedsPercent() { return needsPercent; }
    public void setNeedsPercent(int needsPercent) { this.needsPercent = needsPercent; }
    public int getWantsPercent() { return wantsPercent; }
    public void setWantsPercent(int wantsPercent) { this.wantsPercent = wantsPercent; }
    public int getSavingsPercent() { return savingsPercent; }
    public void setSavingsPercent(int savingsPercent) { this.savingsPercent = savingsPercent; }
    public int getMonthStartDay() { return monthStartDay; }
    public void setMonthStartDay(int monthStartDay) { this.monthStartDay = monthStartDay; }
}
