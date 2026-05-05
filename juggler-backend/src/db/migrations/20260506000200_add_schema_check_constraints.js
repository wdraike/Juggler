'use strict';

exports.up = async function(knex) {
  await knex.raw(`
    ALTER TABLE task_masters
      ADD CONSTRAINT chk_task_masters_pri
        CHECK (pri IN ('P1','P2','P3','P4')),
      ADD CONSTRAINT chk_task_masters_weather_precip
        CHECK (weather_precip IN ('any','wet_ok','light_ok','dry_only') OR weather_precip IS NULL),
      ADD CONSTRAINT chk_task_masters_weather_cloud
        CHECK (weather_cloud IN ('any','overcast_ok','partly_ok','clear') OR weather_cloud IS NULL)
  `);

  await knex.raw(`
    ALTER TABLE task_instances
      ADD CONSTRAINT chk_task_instances_status
        CHECK (status IN ('','wip','done','cancel','skip','pause','disabled'))
  `);
};

exports.down = async function(knex) {
  await knex.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_pri');
  await knex.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_weather_precip');
  await knex.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_weather_cloud');
  await knex.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status');
};
