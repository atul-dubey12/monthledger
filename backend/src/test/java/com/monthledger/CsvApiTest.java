package com.monthledger;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:csv;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class CsvApiTest {
    @Autowired MockMvc mvc;

    private ResultActions post(String url, String body) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(url).contentType(MediaType.APPLICATION_JSON).content(body));
    }
    private String row(int line, String date, String kind, String amount, int category, String note) {
        return "{\"row\":" + line + ",\"date\":\"" + date + "\",\"kind\":\"" + kind + "\",\"amount\":" + amount + ",\"categoryId\":" + category
            + ",\"paymentMode\":\"UPI\",\"note\":" + (note == null ? "null" : "\"" + note + "\"") + ",\"goalId\":null}";
    }

    @Test
    void exportsOldestFirstWithNamesQuotesAndFormulaGuard() throws Exception {
        post("/api/entries", "{\"date\":\"2026-11-08\",\"kind\":\"EXPENSE\",\"amount\":2350.50,\"categoryId\":5,\"paymentMode\":\"UPI\",\"note\":\"=SUM(1,2) \\\"weekly\\\"\"}").andExpect(status().isCreated());
        post("/api/entries", "{\"date\":\"2026-11-05\",\"kind\":\"INCOME\",\"amount\":31000.00,\"categoryId\":1,\"paymentMode\":\"BANK\",\"note\":null}").andExpect(status().isCreated());
        String csv = mvc.perform(get("/api/entries/export")).andExpect(status().isOk())
            .andExpect(header().string("Content-Disposition", startsWith("attachment; filename=\"monthledger-all-")))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        String[] lines = csv.split("\r\n");
        org.junit.jupiter.api.Assertions.assertEquals("﻿Date,Kind,Category,Bucket,Amount,Payment,Note,Goal,Monthly item", lines[0]);
        org.junit.jupiter.api.Assertions.assertEquals("2026-11-05,INCOME,\"Salary\",INCOME,31000,BANK,,,", lines[1]);
        org.junit.jupiter.api.Assertions.assertEquals("2026-11-08,EXPENSE,\"Groceries\",NEED,2350.5,UPI,\"'=SUM(1,2) \"\"weekly\"\"\",,", lines[2]);
        String ranged = mvc.perform(get("/api/entries/export").param("from", "2026-11-06").param("to", "2026-11-30"))
            .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        org.junit.jupiter.api.Assertions.assertEquals(2, ranged.split("\r\n").length);
    }

    @Test
    void importSkipsWhatsSavedKeepsRealRepeatsAndReportsBadRows() throws Exception {
        post("/api/entries", "{\"date\":\"2026-11-10\",\"kind\":\"EXPENSE\",\"amount\":40,\"categoryId\":11,\"paymentMode\":\"UPI\",\"note\":\"Tea\"}").andExpect(status().isCreated());
        String body = "{\"dryRun\":DRY,\"entries\":[" + String.join(",",
            row(2, "2026-11-10", "EXPENSE", "40.00", 11, "Tea"),        // already saved → duplicate
            row(3, "2026-11-10", "EXPENSE", "40", 11, "Tea"),           // second tea that day → new
            row(4, "2026-11-12", "EXPENSE", "0", 11, null),             // bad amount
            row(5, "2026-11-12", "EXPENSE", "500", 1, null),            // Salary as an expense
            row(6, "2026-11-05", "INCOME", "31000", 1, null)) + "]}";
        post("/api/entries/import", body.replace("DRY", "true")).andExpect(status().isOk())
            .andExpect(jsonPath("$.imported").value(2)).andExpect(jsonPath("$.duplicates").value(1))
            .andExpect(jsonPath("$.errors", hasSize(2))).andExpect(jsonPath("$.errors[0].row").value(4))
            .andExpect(jsonPath("$.errors[1].message").value("Salary can't be used for this kind of entry."));
        mvc.perform(get("/api/entries").param("from", "2026-11-01").param("to", "2026-11-30")).andExpect(jsonPath("$", hasSize(1)));
        post("/api/entries/import", body.replace("DRY", "false")).andExpect(jsonPath("$.imported").value(2));
        mvc.perform(get("/api/entries").param("from", "2026-11-01").param("to", "2026-11-30")).andExpect(jsonPath("$", hasSize(3)));
        // The same file again adds nothing.
        post("/api/entries/import", body.replace("DRY", "false")).andExpect(jsonPath("$.imported").value(0)).andExpect(jsonPath("$.duplicates").value(3));
    }

    @Test
    void importAcceptsHiddenCategoriesFromOldBackups() throws Exception {
        mvc.perform(put("/api/categories/16").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Gifts\",\"icon\":\"🎁\",\"bucket\":\"WANT\",\"archived\":true}")).andExpect(status().isOk());
        post("/api/entries", "{\"date\":\"2026-11-10\",\"kind\":\"EXPENSE\",\"amount\":500,\"categoryId\":16,\"paymentMode\":\"UPI\",\"note\":null}").andExpect(status().isBadRequest());
        post("/api/entries/import", "{\"dryRun\":false,\"entries\":[" + row(2, "2025-12-20", "EXPENSE", "500", 16, "Birthday") + "]}")
            .andExpect(jsonPath("$.imported").value(1)).andExpect(jsonPath("$.errors", hasSize(0)));
    }
}
