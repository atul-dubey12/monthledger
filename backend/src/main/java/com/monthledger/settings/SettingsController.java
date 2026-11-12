package com.monthledger.settings;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/settings")
public class SettingsController {
    /** Capped at 28 so every month has the start day. */
    static final int MAX_START_DAY = 28;
    private final SettingsRepository repository;

    public SettingsController(SettingsRepository repository) { this.repository = repository; }

    public record SettingsRequest(String name, Integer needsPercent, Integer wantsPercent, Integer savingsPercent, Integer monthStartDay) {}

    @GetMapping
    public Settings get() { return load(); }

    @PutMapping
    public Settings update(@RequestBody SettingsRequest request) {
        String name = request.name() == null ? "" : request.name().trim();
        if (name.length() > 30) throw bad("Name can be up to 30 characters.");
        Integer needs = request.needsPercent(), wants = request.wantsPercent(), savings = request.savingsPercent();
        if (needs == null || wants == null || savings == null) throw bad("Set a percentage for needs, wants and savings.");
        if (needs < 0 || wants < 0 || savings < 0) throw bad("Percentages cannot be negative.");
        if (needs + wants + savings != 100) throw bad("Needs, wants and savings must add up to 100%.");
        Integer day = request.monthStartDay();
        if (day == null || day < 1 || day > MAX_START_DAY) throw bad("Month start day must be between 1 and " + MAX_START_DAY + ".");
        Settings settings = load();
        settings.setName(name);
        settings.setNeedsPercent(needs);
        settings.setWantsPercent(wants);
        settings.setSavingsPercent(savings);
        settings.setMonthStartDay(day);
        return repository.save(settings);
    }

    private Settings load() {
        return repository.findById(1).orElseThrow(() -> new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Settings row is missing."));
    }

    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
